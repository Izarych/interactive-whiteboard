import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import type { ActiveSession, EmailChallenge, SessionInfo, UserProfile } from '@whiteboard/shared';
import { DatabaseService } from '../database.service';
import { MailService } from './mail.service';
import { digest, hashPassword, verifyPassword } from './auth.crypto';
import { RegisterDto, ResetPasswordDto, UpdateProfileDto, VerifyEmailDto } from './auth.dto';
import type { AuthContext } from './auth.types';

const COOKIE = 'bb_session';
const INVALID_CODE = 'Неверный или истёкший код. Проверьте письмо или запросите новый код.';
interface ChallengeRow {
  id: string; email: string; workspace_id: string | null; code_hash: string;
  attempts: number; expires_at: Date; payload: { name?: string; passwordHash?: string; avatarAssetId?: string };
}

@Injectable()
export class AuthService {
  private readonly secret: string;
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService, private readonly mail: MailService) {
    this.secret = config.getOrThrow<string>('AUTH_SECRET');
    if (this.secret.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters');
  }

  private token(request: Request): string | null {
    const token = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }

  private cookieOptions() {
    return { httpOnly: true, sameSite: 'lax' as const, secure: this.config.get<string>('COOKIE_SECURE', 'false') === 'true', path: '/api' };
  }

  private setCookie(response: Response, token: string, guest: boolean) {
    response.cookie(COOKIE, token, { ...this.cookieOptions(), maxAge: (guest ? 180 : 30) * 86400000 });
  }

  async resolve(request: Request): Promise<AuthContext | null> {
    const token = this.token(request);
    if (!token) return null;
    const result = await this.db.pool.query(
      `SELECT w.id AS "workspaceId", w.user_id AS "userId", u.role FROM sessions s JOIN workspace_owners w ON w.id = s.workspace_id
       LEFT JOIN users u ON u.id = w.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND w.merged_into_id IS NULL AND w.blocked_at IS NULL AND u.blocked_at IS NULL`, [digest(token)],
    );
    if (result.rowCount) await this.db.pool.query(`WITH touched AS (
      UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1 AND last_seen_at < now() - interval '2 minutes' RETURNING workspace_id
    ) UPDATE workspace_owners w SET last_seen_at = now() FROM touched t WHERE w.id = t.workspace_id`, [digest(token)]);
    return result.rows[0] ?? null;
  }

  async requireContext(request: Request): Promise<AuthContext> {
    const context = await this.resolve(request);
    if (!context) throw new UnauthorizedException('Сессия завершилась. Войдите или продолжите как гость.');
    return context;
  }

  private user(row: { id: string; email: string; name: string; avatar_asset_id: string | null; role: 'user' | 'admin' }): UserProfile {
    return { id: row.id, email: row.email, name: row.name, role: row.role, avatarUrl: row.avatar_asset_id ? `/api/assets/${row.avatar_asset_id}` : null };
  }

  async info(context: AuthContext): Promise<ActiveSession> {
    if (!context.userId) return { kind: 'guest', workspaceId: context.workspaceId, user: null };
    const result = await this.db.pool.query('SELECT id, email, name, avatar_asset_id, role FROM users WHERE id = $1', [context.userId]);
    if (!result.rowCount) throw new UnauthorizedException('Войдите в аккаунт заново');
    return { kind: 'user', workspaceId: context.workspaceId, user: this.user(result.rows[0]) };
  }

  async session(request: Request): Promise<SessionInfo> {
    const context = await this.resolve(request);
    return context ? this.info(context) : { kind: 'anonymous', workspaceId: null, user: null };
  }

  async limit(namespace: string, value: string, maximum: number, seconds = 900): Promise<void> {
    const result = await this.db.pool.query(
      `INSERT INTO auth_rate_limits (key, count, expires_at) VALUES ($1, 1, now() + $2 * interval '1 second')
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.count + 1 END,
         expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
       RETURNING count`, [`${namespace}:${digest(value)}`, seconds],
    );
    if (result.rows[0].count > maximum) throw new HttpException('Слишком много попыток. Попробуйте немного позже.', 429);
  }

  private async newSession(client: PoolClient, context: AuthContext): Promise<string> {
    await client.query('UPDATE workspace_owners SET last_seen_at = now() WHERE id = $1', [context.workspaceId]);
    const token = randomBytes(32).toString('base64url');
    await client.query('INSERT INTO sessions (token_hash, workspace_id, expires_at) VALUES ($1, $2, now() + $3 * interval \'1 day\')',
      [digest(token), context.workspaceId, context.userId ? 30 : 180]);
    return token;
  }

  async guest(request: Request, response: Response): Promise<ActiveSession> {
    const current = await this.resolve(request);
    if (current) return this.info(current);
    await this.limit('guest-ip', request.ip ?? '', 1000, 86400);
    const context: AuthContext = { workspaceId: randomUUID(), userId: null };
    const token = await this.db.transaction(async (client) => {
      await client.query('INSERT INTO workspace_owners (id) VALUES ($1)', [context.workspaceId]);
      await this.db.event('guest_started', context.workspaceId, null, client);
      return this.newSession(client, context);
    });
    this.setCookie(response, token, true);
    return this.info(context);
  }

  private async guestWorkspace(client: PoolClient, context: AuthContext) {
    const result = await client.query('SELECT user_id FROM workspace_owners WHERE id = $1 AND merged_into_id IS NULL FOR UPDATE', [context.workspaceId]);
    if (!result.rowCount || result.rows[0].user_id) throw new BadRequestException('Регистрация доступна из гостевой сессии. Выйдите из текущего аккаунта.');
  }

  private codeHash(id: string, code: string): string {
    return createHmac('sha256', this.secret).update(`${id}:${code}`).digest('hex');
  }

  private async issue(client: PoolClient, email: string, purpose: 'register' | 'reset', workspaceId: string | null, payload: object): Promise<EmailChallenge> {
    const id = randomUUID();
    const code = randomInt(1000000).toString().padStart(6, '0');
    const result = await client.query(
      `INSERT INTO auth_challenges (id, email, purpose, workspace_id, code_hash, expires_at, payload)
       VALUES ($1, $2, $3, $4, $5, now() + interval '15 minutes', $6::jsonb)
       ON CONFLICT (email, purpose) DO UPDATE SET id = EXCLUDED.id, workspace_id = EXCLUDED.workspace_id,
         code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, sent_at = now(), payload = EXCLUDED.payload
       WHERE auth_challenges.sent_at <= now() - interval '60 seconds'
       RETURNING expires_at`, [id, email, purpose, workspaceId, this.codeHash(id, code), JSON.stringify(payload)],
    );
    if (!result.rowCount) throw new HttpException('Код уже отправлен. Новый код можно запросить через минуту.', 429);
    await this.mail.sendCode(email, code, purpose);
    return { challengeId: id, email, expiresAt: result.rows[0].expires_at.toISOString(), retryAfterSeconds: 60 };
  }

  private async validateAvatar(client: PoolClient, workspaceId: string, assetId?: string | null) {
    if (!assetId) return;
    const result = await client.query('SELECT id FROM image_assets WHERE id = $1 AND owner_id = $2 AND purpose = \'avatar\'', [assetId, workspaceId]);
    if (!result.rowCount) throw new BadRequestException('Аватар не найден. Загрузите изображение заново.');
  }

  async register(context: AuthContext, dto: RegisterDto, ip: string): Promise<EmailChallenge> {
    await this.limit('register-ip', ip, 100, 3600);
    await this.limit('register-email', dto.email, 10, 3600);
    const existing = await this.db.pool.query('SELECT id FROM users WHERE email = $1', [dto.email]);
    if (existing.rowCount) throw new ConflictException('Аккаунт с этой почтой уже существует. Войдите или восстановите пароль.');
    const passwordHash = await hashPassword(dto.password);
    return this.db.transaction(async (client) => {
      await this.guestWorkspace(client, context);
      await this.validateAvatar(client, context.workspaceId, dto.avatarAssetId);
      return this.issue(client, dto.email, 'register', context.workspaceId, { name: dto.name, passwordHash, avatarAssetId: dto.avatarAssetId });
    });
  }

  async resend(context: AuthContext, id: string, ip: string): Promise<EmailChallenge> {
    await this.limit('register-ip', ip, 100, 3600);
    return this.db.transaction(async (client) => {
      await this.guestWorkspace(client, context);
      const result = await client.query('SELECT email, payload FROM auth_challenges WHERE id = $1 AND purpose = \'register\' AND workspace_id = $2', [id, context.workspaceId]);
      if (!result.rowCount) throw new BadRequestException('Начните регистрацию заново');
      return this.issue(client, result.rows[0].email, 'register', context.workspaceId, result.rows[0].payload);
    });
  }

  private async checkCode(client: PoolClient, dto: VerifyEmailDto, purpose: 'register' | 'reset', workspaceId?: string): Promise<ChallengeRow | null> {
    const result = await client.query('SELECT * FROM auth_challenges WHERE id = $1 AND purpose = $2 FOR UPDATE', [dto.challengeId, purpose]);
    const row = result.rows[0] as ChallengeRow | undefined;
    if (!row || row.expires_at.getTime() <= Date.now() || row.attempts >= 5 || (workspaceId && row.workspace_id !== workspaceId)) {
      throw new BadRequestException(INVALID_CODE);
    }
    if (!timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(this.codeHash(row.id, dto.code), 'hex'))) {
      await client.query('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return null; // Commit failed attempts so retry limits cannot be bypassed with a rollback.
    }
    return row;
  }

  private async claimLegacy(client: PoolClient, email: string, workspaceId: string) {
    const legacyEmail = this.config.get<string>('LEGACY_OWNER_EMAIL')?.trim().toLowerCase();
    if (legacyEmail && email === legacyEmail) {
      await client.query('UPDATE boards SET owner_id = $1 WHERE owner_id IS NULL', [workspaceId]);
      await client.query('UPDATE image_assets SET owner_id = $1 WHERE owner_id IS NULL', [workspaceId]);
    }
  }

  async verify(context: AuthContext, dto: VerifyEmailDto, response: Response, ip: string): Promise<ActiveSession> {
    await this.limit('verify-ip', ip, 60);
    const result = await this.db.transaction(async (client) => {
      await this.guestWorkspace(client, context);
      const challenge = await this.checkCode(client, dto, 'register', context.workspaceId);
      if (!challenge) return null;
      const userId = randomUUID();
      const created = await client.query(
        `INSERT INTO users (id, email, password_hash, name, avatar_asset_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [userId, challenge.email, challenge.payload.passwordHash, challenge.payload.name, challenge.payload.avatarAssetId ?? null],
      );
      if (!created.rowCount) throw new ConflictException('Аккаунт уже существует. Войдите в него.');
      // A guest workspace becomes the new user's workspace; no drawing/file is recopied or lost.
      await client.query('UPDATE workspace_owners SET user_id = $1 WHERE id = $2', [userId, context.workspaceId]);
      await this.claimLegacy(client, challenge.email, context.workspaceId);
      await client.query('DELETE FROM auth_challenges WHERE id = $1', [challenge.id]);
      await client.query('DELETE FROM sessions WHERE workspace_id = $1', [context.workspaceId]);
      const next = { workspaceId: context.workspaceId, userId };
      await this.db.event('registered', next.workspaceId, userId, client);
      return { context: next, token: await this.newSession(client, next) };
    });
    if (!result) throw new BadRequestException(INVALID_CODE);
    this.setCookie(response, result.token, false);
    return this.info(result.context);
  }

  async login(request: Request, response: Response, email: string, password: string, adminOnly = false): Promise<ActiveSession> {
    await this.limit(adminOnly ? 'admin-login-ip' : 'login-ip', request.ip ?? '', adminOnly ? 10 : 30);
    const found = await this.db.pool.query('SELECT id, password_hash, blocked_at, role FROM users WHERE email = $1', [email]);
    const user = found.rows[0];
    if (!await verifyPassword(password, user?.password_hash) || !user) throw new UnauthorizedException('Неверная почта или пароль');
    if (user.blocked_at) throw new HttpException('Аккаунт заблокирован. Обратитесь к администратору.', 403);
    if (adminOnly && user.role !== 'admin') throw new ForbiddenException('Для входа требуется административный аккаунт');
    const current = await this.resolve(request);
    const result = await this.db.transaction(async (client) => {
      const locked = await client.query('SELECT password_hash, blocked_at, role FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      if (locked.rows[0]?.password_hash !== user.password_hash) throw new UnauthorizedException('Пароль изменился. Войдите заново.');
      if (locked.rows[0].blocked_at) throw new HttpException('Аккаунт заблокирован', 403);
      if (adminOnly && locked.rows[0].role !== 'admin') throw new ForbiddenException('Недостаточно прав');
      const owner = await client.query('SELECT id FROM workspace_owners WHERE user_id = $1', [user.id]);
      const workspaceId = owner.rows[0].id as string;
      if (current && !current.userId && current.workspaceId !== workspaceId) {
        await client.query('SELECT id FROM workspace_owners WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[current.workspaceId, workspaceId]]);
        // The lock also serializes guest board/file creation with workspace merging.
        const source = await client.query('SELECT user_id, merged_into_id FROM workspace_owners WHERE id = $1', [current.workspaceId]);
        if (!source.rows[0]?.user_id && !source.rows[0]?.merged_into_id) {
          await client.query('UPDATE boards SET owner_id = $1 WHERE owner_id = $2', [workspaceId, current.workspaceId]);
          await client.query('UPDATE image_assets SET owner_id = $1 WHERE owner_id = $2', [workspaceId, current.workspaceId]);
          await client.query(`UPDATE workspace_owners target SET tool_shortcuts=source.tool_shortcuts
            FROM workspace_owners source WHERE target.id=$1 AND source.id=$2 AND target.tool_shortcuts='{}'::jsonb`, [workspaceId, current.workspaceId]);
          await client.query(`UPDATE workspace_owners target SET tool_panel_pinned=source.tool_panel_pinned
            FROM workspace_owners source WHERE target.id=$1 AND source.id=$2 AND target.tool_panel_pinned IS NULL`, [workspaceId, current.workspaceId]);
          await client.query('UPDATE workspace_owners SET merged_into_id = $1 WHERE id = $2', [workspaceId, current.workspaceId]);
          await client.query('DELETE FROM sessions WHERE workspace_id = $1', [current.workspaceId]);
          await client.query('DELETE FROM auth_challenges WHERE workspace_id = $1', [current.workspaceId]);
        }
      }
      const previous = this.token(request);
      if (previous) await client.query('DELETE FROM sessions WHERE token_hash = $1', [digest(previous)]);
      await this.claimLegacy(client, email, workspaceId);
      const context = { workspaceId, userId: user.id as string };
      await this.db.event('login', workspaceId, context.userId, client);
      return { context, token: await this.newSession(client, context) };
    });
    this.setCookie(response, result.token, false);
    return this.info(result.context);
  }

  async logout(request: Request, response: Response): Promise<void> {
    const token = this.token(request);
    if (token) await this.db.pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
    response.clearCookie(COOKIE, this.cookieOptions());
  }

  async forgot(email: string, ip: string): Promise<EmailChallenge> {
    await this.limit('forgot-ip', ip, 30, 3600);
    await this.limit('forgot-email', email, 5, 3600);
    const found = await this.db.pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!found.rowCount) return { challengeId: randomUUID(), email, expiresAt: new Date(Date.now() + 900000).toISOString(), retryAfterSeconds: 60 };
    return this.db.transaction((client) => this.issue(client, email, 'reset', null, {}));
  }

  async reset(dto: ResetPasswordDto, request: Request, response: Response): Promise<void> {
    await this.limit('reset-ip', request.ip ?? '', 60);
    const passwordHash = await hashPassword(dto.password);
    const current = await this.resolve(request);
    const userId = await this.db.transaction(async (client) => {
      const challenge = await this.checkCode(client, dto, 'reset');
      if (!challenge) return null;
      const updated = await client.query('UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id', [passwordHash, challenge.email]);
      if (!updated.rowCount) throw new BadRequestException(INVALID_CODE);
      await client.query('DELETE FROM sessions WHERE workspace_id IN (SELECT id FROM workspace_owners WHERE user_id = $1)', [updated.rows[0].id]);
      await client.query('DELETE FROM auth_challenges WHERE id = $1', [challenge.id]);
      return updated.rows[0].id as string;
    });
    if (!userId) throw new BadRequestException(INVALID_CODE);
    if (current?.userId === userId) response.clearCookie(COOKIE, this.cookieOptions());
  }

  async updateProfile(context: AuthContext, dto: UpdateProfileDto): Promise<UserProfile> {
    if (!context.userId) throw new UnauthorizedException('Войдите в аккаунт, чтобы изменить профиль');
    return this.db.transaction(async (client) => {
      await this.validateAvatar(client, context.workspaceId, dto.avatarAssetId);
      const result = await client.query(
        `UPDATE users SET name = $2, avatar_asset_id = CASE WHEN $4 THEN $3::uuid ELSE avatar_asset_id END
         WHERE id = $1 RETURNING id, email, name, avatar_asset_id, role`, [context.userId, dto.name, dto.avatarAssetId ?? null, dto.avatarAssetId !== undefined],
      );
      return this.user(result.rows[0]);
    });
  }
}
