import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AdminBoard, AdminGuest, AdminOverview, AdminPage, AdminUser, Board } from '@whiteboard/shared';
import { DatabaseService } from '../database.service';
import { StorageService } from '../storage.service';
import type { StoredFile } from '../storage.service';
import { AssetsService } from '../assets.service';
import { hashPassword, verifyPassword } from '../auth/auth.crypto';
import type { AuthContext } from '../auth/auth.types';
import { AdminCreateUserDto, AdminQueryDto, AdminUpdateUserDto } from './admin.dto';

const userColumns = `u.id, u.email, u.name, u.role, CASE WHEN u.avatar_asset_id IS NOT NULL THEN '/api/assets/' || u.avatar_asset_id::text ELSE NULL END AS "avatarUrl",
  w.id AS "workspaceId", u.blocked_at AS "blockedAt", u.created_at AS "createdAt", w.last_seen_at AS "lastSeenAt",
  (SELECT count(*)::int FROM boards b WHERE b.owner_id = w.id) AS boards,
  (SELECT count(*)::int FROM image_assets a WHERE a.owner_id = w.id) AS assets,
  (SELECT count(*)::int FROM sessions s WHERE s.workspace_id = w.id AND s.expires_at > now()) AS sessions`;
const boardColumns = `b.id, b.title, b.revision, b.created_at AS "createdAt", b.updated_at AS "updatedAt", b.owner_id AS "ownerId", u.name AS "ownerName", u.email AS "ownerEmail",
  jsonb_array_length(b.document->'elements') AS elements,
  (SELECT count(*)::int FROM jsonb_array_elements(b.document->'elements') e WHERE e->>'kind' = 'image') AS images`;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(private readonly db: DatabaseService, private readonly storage: StorageService, private readonly assets: AssetsService) {}

  private async audit(client: PoolClient, actor: AuthContext, action: string, targetId: string | null, details: object = {}) {
    await client.query('INSERT INTO admin_audit (actor_id, action, target_id, details) VALUES ($1, $2, $3, $4::jsonb)', [actor.userId, action, targetId, JSON.stringify(details)]);
  }
  private async page<T>(select: string, count: string, parameters: unknown[], query: AdminQueryDto): Promise<AdminPage<T>> {
    const offset = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.db.pool.query(`${select} LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`, [...parameters, query.pageSize, offset]),
      this.db.pool.query(count, parameters),
    ]);
    return { items: rows.rows, total: total.rows[0].total, page: query.page, pageSize: query.pageSize };
  }

  async users(query: AdminQueryDto): Promise<AdminPage<AdminUser>> {
    const where = `WHERE (u.name ILIKE $1 OR u.email ILIKE $1) AND ($2 = 'all' OR ($2 = 'blocked' AND u.blocked_at IS NOT NULL) OR ($2 = 'active' AND u.blocked_at IS NULL))`;
    return this.page(`SELECT ${userColumns} FROM users u JOIN workspace_owners w ON w.user_id = u.id ${where} ORDER BY u.created_at DESC, u.id`,
      `SELECT count(*)::int AS total FROM users u ${where}`, [`%${query.search}%`, query.status], query);
  }
  async guests(query: AdminQueryDto): Promise<AdminPage<AdminGuest>> {
    const where = `WHERE w.user_id IS NULL AND w.merged_into_id IS NULL AND w.id::text ILIKE $1
      AND ($2 = 'all' OR ($2 = 'blocked' AND w.blocked_at IS NOT NULL) OR ($2 = 'active' AND w.blocked_at IS NULL))`;
    return this.page(`SELECT w.id, w.created_at AS "createdAt", w.blocked_at AS "blockedAt", w.last_seen_at AS "lastSeenAt",
      (SELECT count(*)::int FROM boards b WHERE b.owner_id = w.id) AS boards,
      (SELECT count(*)::int FROM image_assets a WHERE a.owner_id = w.id) AS assets,
      (SELECT count(*)::int FROM sessions s WHERE s.workspace_id = w.id AND s.expires_at > now()) AS sessions
      FROM workspace_owners w ${where} ORDER BY w.created_at DESC, w.id`, `SELECT count(*)::int AS total FROM workspace_owners w ${where}`, [`%${query.search}%`, query.status], query);
  }
  async boards(query: AdminQueryDto): Promise<AdminPage<AdminBoard>> {
    const from = `FROM boards b LEFT JOIN workspace_owners w ON w.id = b.owner_id LEFT JOIN users u ON u.id = w.user_id
      WHERE b.title ILIKE $1 OR COALESCE(u.email,'') ILIKE $1 OR b.id::text ILIKE $1`;
    return this.page(`SELECT ${boardColumns} ${from} ORDER BY b.updated_at DESC, b.id`, `SELECT count(*)::int AS total ${from}`, [`%${query.search}%`], query);
  }
  async images(query: AdminQueryDto) {
    const from = `FROM image_assets a LEFT JOIN workspace_owners w ON w.id = a.owner_id LEFT JOIN users u ON u.id = w.user_id
      WHERE a.id::text ILIKE $1 OR COALESCE(u.email,'') ILIKE $1`;
    return this.page(`SELECT a.id, '/api/assets/' || a.id::text AS url, a.width, a.height, a.size, a.purpose,
      a.storage_provider AS provider, a.owner_id AS "ownerId", u.name AS "ownerName", u.email AS "ownerEmail", a.created_at AS "createdAt"
      ${from} ORDER BY a.created_at DESC, a.id`, `SELECT count(*)::int AS total ${from}`, [`%${query.search}%`], query);
  }
  async auditLog(query: AdminQueryDto) {
    const from = `FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action ILIKE $1 OR COALESCE(u.email,'') ILIKE $1`;
    return this.page(`SELECT a.id::text, a.action, u.name AS "actorName", a.target_id AS "targetId", a.details, a.created_at AS "createdAt"
      ${from} ORDER BY a.created_at DESC, a.id DESC`, `SELECT count(*)::int AS total ${from}`, [`%${query.search}%`], query);
  }
  async overview(days: number): Promise<AdminOverview> {
    const [counts, trend, recentUsers, recentBoards] = await Promise.all([
      this.db.pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM workspace_owners WHERE user_id IS NULL AND merged_into_id IS NULL) AS guests,
        (SELECT count(*)::int FROM boards) AS boards,
        (SELECT count(*)::int FROM image_assets) AS images,
        (SELECT coalesce(sum(size),0)::float8 FROM image_assets) AS bytes,
        (SELECT count(*)::int FROM sessions s JOIN workspace_owners w ON w.id=s.workspace_id LEFT JOIN users u ON u.id=w.user_id
          WHERE s.expires_at>now() AND w.blocked_at IS NULL AND u.blocked_at IS NULL AND w.merged_into_id IS NULL) AS sessions,
        (SELECT count(*)::int FROM users WHERE blocked_at IS NOT NULL) AS "blockedUsers",
        (SELECT count(*)::int FROM workspace_owners WHERE last_seen_at > now() - interval '7 days' AND merged_into_id IS NULL) AS "activeWorkspaces",
        (SELECT count(*)::int FROM auth_challenges WHERE purpose='register' AND expires_at>now()) AS "pendingRegistrations"`),
      this.db.pool.query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
        count(e.id) FILTER (WHERE e.type IN ('registered','admin_user_created'))::int AS users,
        count(e.id) FILTER (WHERE e.type='guest_started')::int AS guests,
        count(e.id) FILTER (WHERE e.type='board_created')::int AS boards
        FROM generate_series(current_date - ($1::int-1), current_date, interval '1 day') d(day)
        LEFT JOIN activity_events e ON e.created_at >= d.day AND e.created_at < d.day + interval '1 day'
        GROUP BY d.day ORDER BY d.day`, [days]),
      this.users(Object.assign(new AdminQueryDto(), { pageSize: 5 })), this.boards(Object.assign(new AdminQueryDto(), { pageSize: 5 })),
    ]);
    return { ...counts.rows[0], trend: trend.rows, recentUsers: recentUsers.items, recentBoards: recentBoards.items };
  }
  async board(id: string): Promise<Board & AdminBoard> {
    const result = await this.db.pool.query(`SELECT ${boardColumns}, b.document FROM boards b
      LEFT JOIN workspace_owners w ON w.id=b.owner_id LEFT JOIN users u ON u.id=w.user_id WHERE b.id=$1`, [id]);
    if (!result.rowCount) throw new NotFoundException('Доска не найдена');
    return result.rows[0];
  }

  async createUser(actor: AuthContext, dto: AdminCreateUserDto) {
    if (dto.avatarAssetId) throw new BadRequestException('Добавьте аватар после создания пользователя');
    const hash = await hashPassword(dto.password), id = randomUUID(), workspace = randomUUID();
    await this.db.transaction(async (client) => {
      const result = await client.query(`INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4)
        ON CONFLICT (email) DO NOTHING RETURNING id`, [id, dto.email, dto.name, hash]);
      if (!result.rowCount) throw new ConflictException('Аккаунт с этой почтой уже существует');
      await client.query('INSERT INTO workspace_owners (id,user_id) VALUES ($1,$2)', [workspace, id]);
      await this.db.event('admin_user_created', workspace, id, client);
      await this.audit(client, actor, 'user_created', id, { email: dto.email, name: dto.name });
    });
    return { id };
  }
  async updateUser(actor: AuthContext, id: string, dto: AdminUpdateUserDto) {
    if (dto.avatarAssetId) throw new BadRequestException('Используйте загрузку аватара');
    await this.db.transaction(async (client) => {
      const result = await client.query(`UPDATE users SET name=$2, avatar_asset_id=CASE WHEN $3 THEN NULL ELSE avatar_asset_id END WHERE id=$1 RETURNING id`, [id, dto.name, dto.avatarAssetId === null]);
      if (!result.rowCount) throw new NotFoundException('Пользователь не найден');
      await this.audit(client, actor, 'user_updated', id, { name: dto.name, removedAvatar: dto.avatarAssetId === null });
    });
  }
  async avatar(actor: AuthContext, id: string, file?: Express.Multer.File) {
    const found = await this.db.pool.query('SELECT id FROM workspace_owners WHERE user_id=$1', [id]);
    if (!found.rowCount) throw new NotFoundException('Пользователь не найден');
    const asset = await this.assets.upload({ workspaceId: found.rows[0].id, userId: id }, file, 'avatar');
    await this.db.transaction(async (client) => {
      await client.query('UPDATE users SET avatar_asset_id=$2 WHERE id=$1', [id, asset.id]);
      await this.audit(client, actor, 'avatar_changed', id, { assetId: asset.id });
    });
    return asset;
  }
  async password(actor: AuthContext, id: string, password: string) {
    const hash = await hashPassword(password);
    await this.db.transaction(async (client) => {
      const result = await client.query('UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id', [id, hash]);
      if (!result.rowCount) throw new NotFoundException('Пользователь не найден');
      await client.query('DELETE FROM sessions WHERE workspace_id IN (SELECT id FROM workspace_owners WHERE user_id=$1)', [id]);
      await client.query('DELETE FROM auth_challenges WHERE email IN (SELECT email FROM users WHERE id=$1)', [id]);
      await this.audit(client, actor, 'password_changed', id);
    });
  }
  async role(actor: AuthContext, id: string, role: 'user' | 'admin', password: string) {
    await this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(73194521)');
      const locked = await client.query('SELECT id, role, blocked_at, password_hash FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[actor.userId, id]]);
      const administrator = locked.rows.find((row) => row.id === actor.userId);
      const target = locked.rows.find((row) => row.id === id);
      if (!administrator || administrator.role !== 'admin' || administrator.blocked_at) throw new ForbiddenException('Недостаточно прав');
      if (!await verifyPassword(password, administrator.password_hash)) throw new ForbiddenException('Неверный пароль администратора');
      if (!target) throw new NotFoundException('Пользователь не найден');
      if (id === actor.userId && role !== 'admin') throw new BadRequestException('Нельзя снять административную роль с собственного аккаунта');
      if (role === 'admin' && target.blocked_at) throw new BadRequestException('Сначала разблокируйте аккаунт');
      if (target.role === role) return;
      await client.query('UPDATE users SET role=$2 WHERE id=$1', [id, role]);
      await client.query('DELETE FROM sessions WHERE workspace_id IN (SELECT id FROM workspace_owners WHERE user_id=$1)', [id]);
      await this.audit(client, actor, 'role_changed', id, { from: target.role, to: role });
    });
  }
  async block(actor: AuthContext, kind: 'users' | 'guests', id: string, blocked: boolean) {
    if (kind === 'users' && actor.userId === id) throw new BadRequestException('Нельзя заблокировать собственный административный аккаунт');
    await this.db.transaction(async (client) => {
      const result = kind === 'users'
        ? await client.query('UPDATE users SET blocked_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 RETURNING id', [id, blocked])
        : await client.query('UPDATE workspace_owners SET blocked_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 AND user_id IS NULL AND merged_into_id IS NULL RETURNING id', [id, blocked]);
      if (!result.rowCount) throw new NotFoundException('Запись не найдена');
      if (blocked && kind === 'users') await client.query('DELETE FROM sessions WHERE workspace_id IN (SELECT id FROM workspace_owners WHERE user_id=$1)', [id]);
      await this.audit(client, actor, blocked ? `${kind}_blocked` : `${kind}_unblocked`, id);
    });
  }
  async revokeSessions(actor: AuthContext, id: string) {
    await this.db.transaction(async (client) => {
      const user = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!user.rowCount) throw new NotFoundException('Пользователь не найден');
      await client.query('DELETE FROM sessions WHERE workspace_id IN (SELECT id FROM workspace_owners WHERE user_id=$1)', [id]);
      await this.audit(client, actor, 'sessions_revoked', id);
    });
  }
  private async removeFiles(files: StoredFile[]) {
    for (const file of files) await this.storage.remove(file).catch((error) => this.logger.error('Deleted account file cleanup failed', error));
  }
  async deleteOwner(actor: AuthContext, kind: 'users' | 'guests', id: string) {
    if (kind === 'users' && actor.userId === id) throw new BadRequestException('Нельзя удалить собственный административный аккаунт');
    const files = await this.db.transaction(async (client) => {
      if (kind === 'users') await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
      const owner = kind === 'users'
        ? await client.query('SELECT id FROM workspace_owners WHERE user_id=$1 FOR UPDATE', [id])
        : await client.query('SELECT id FROM workspace_owners WHERE id=$1 AND user_id IS NULL AND merged_into_id IS NULL FOR UPDATE', [id]);
      if (!owner.rowCount) throw new NotFoundException('Запись не найдена');
      const files = await client.query('SELECT storage_provider AS provider, storage_bucket AS bucket, storage_key AS key FROM image_assets WHERE owner_id=$1', [owner.rows[0].id]);
      await this.audit(client, actor, `${kind}_deleted`, id, { removedFiles: files.rowCount });
      await client.query(kind === 'users' ? 'DELETE FROM users WHERE id=$1' : 'DELETE FROM workspace_owners WHERE id=$1', [id]);
      return files.rows as StoredFile[];
    });
    await this.removeFiles(files);
  }
  async transferGuest(actor: AuthContext, id: string, email: string) {
    await this.db.transaction(async (client) => {
      const target = await client.query('SELECT w.id FROM workspace_owners w JOIN users u ON u.id=w.user_id WHERE u.email=$1 AND u.blocked_at IS NULL', [email]);
      if (!target.rowCount) throw new NotFoundException('Активный аккаунт с этой почтой не найден');
      const destination = target.rows[0].id;
      await client.query('SELECT id FROM workspace_owners WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[id, destination]]);
      const source = await client.query('SELECT id FROM workspace_owners WHERE id=$1 AND user_id IS NULL AND merged_into_id IS NULL', [id]);
      if (!source.rowCount) throw new NotFoundException('Гостевое пространство не найдено');
      const boards = await client.query('UPDATE boards SET owner_id=$2 WHERE owner_id=$1', [id, destination]);
      await client.query('UPDATE image_assets SET owner_id=$2 WHERE owner_id=$1', [id, destination]);
      await client.query('UPDATE workspace_owners SET merged_into_id=$2 WHERE id=$1', [id, destination]);
      await client.query('DELETE FROM sessions WHERE workspace_id=$1', [id]);
      await client.query('DELETE FROM auth_challenges WHERE workspace_id=$1', [id]);
      await this.audit(client, actor, 'guest_transferred', id, { email, boards: boards.rowCount });
    });
  }
  async updateBoard(actor: AuthContext, id: string, title: string) {
    await this.db.transaction(async (client) => {
      const result = await client.query('UPDATE boards SET title=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING id', [id, title]);
      if (!result.rowCount) throw new NotFoundException('Доска не найдена');
      await this.audit(client, actor, 'board_renamed', id, { title });
    });
  }
  async clearBoard(actor: AuthContext, id: string) {
    await this.db.transaction(async (client) => {
      const result = await client.query(`UPDATE boards SET document=jsonb_set(document,'{elements}','[]'::jsonb), revision=revision+1, updated_at=now() WHERE id=$1 RETURNING id`, [id]);
      if (!result.rowCount) throw new NotFoundException('Доска не найдена');
      await this.audit(client, actor, 'board_cleared', id);
    });
  }
  async deleteBoard(actor: AuthContext, id: string) {
    await this.db.transaction(async (client) => {
      const result = await client.query('DELETE FROM boards WHERE id=$1 RETURNING title', [id]);
      if (!result.rowCount) throw new NotFoundException('Доска не найдена');
      await this.audit(client, actor, 'board_deleted', id, { title: result.rows[0].title });
    });
  }
  async deleteImage(actor: AuthContext, id: string) {
    const file = await this.db.transaction(async (client) => {
      const locked = await client.query('SELECT id FROM image_assets WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rowCount) throw new NotFoundException('Изображение не найдено');
      const used = await client.query(`SELECT 1 FROM boards b, jsonb_array_elements(b.document->'elements') e WHERE e->>'assetId'=$1
        UNION ALL SELECT 1 FROM users WHERE avatar_asset_id=$1::uuid LIMIT 1`, [id]);
      if (used.rowCount) throw new ConflictException('Изображение используется доской или профилем. Удалите его из содержимого перед удалением файла.');
      const removed = await client.query('DELETE FROM image_assets WHERE id=$1 RETURNING storage_provider AS provider, storage_bucket AS bucket, storage_key AS key', [id]);
      if (!removed.rowCount) throw new NotFoundException('Изображение не найдено');
      await this.audit(client, actor, 'image_deleted', id);
      return removed.rows[0] as StoredFile;
    });
    await this.removeFiles([file]);
  }
}
