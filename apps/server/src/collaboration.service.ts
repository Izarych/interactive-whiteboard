import { BadRequestException, Injectable, NotFoundException, ValidationPipe } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import type { Board, BoardOperation, SharingState } from '@whiteboard/shared';
import { applyOperation, difference } from '@whiteboard/shared/board-operations';
import { DatabaseService } from './database.service';
import { BoardsService } from './boards.service';
import { AuthService } from './auth/auth.service';
import { UpdateBoardDto } from './boards.dto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const columns = `b.id, b.title, b.document, b.revision, b.collaborative, b.created_at AS "createdAt", b.updated_at AS "updatedAt", b.owner_id, b.share_token`;
const activeOwner = `JOIN workspace_owners w ON w.id=b.owner_id LEFT JOIN users u ON u.id=w.user_id`;
const active = `w.merged_into_id IS NULL AND w.blocked_at IS NULL AND u.blocked_at IS NULL`;
export interface BoardAccess { request: Request; boardId: string; token?: string }
export interface CommittedChange { baseRevision: number; operation: BoardOperation }

@Injectable()
export class CollaborationService {
  private readonly validation = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  constructor(private readonly db: DatabaseService, private readonly boards: BoardsService, private readonly auth: AuthService) {}

  async authorize(access: BoardAccess, client?: PoolClient, lock = false, includeDocument = true) {
    if (!uuid.test(access.boardId)) throw new NotFoundException('Доска больше недоступна');
    const owner = access.token ? null : await this.auth.resolve(access.request, client);
    const result = await (client ?? this.db.pool).query(
      `SELECT ${includeDocument ? columns : 'b.id, b.owner_id, b.share_token'} FROM boards b ${activeOwner} WHERE b.id=$1 AND ${active} ${lock ? 'FOR UPDATE OF b' : ''}`, [access.boardId]);
    const row = result.rows[0];
    if (!row || (access.token ? !/^[\w-]{43}$/.test(access.token) || row.share_token !== access.token : !owner || row.owner_id !== owner.workspaceId)) {
      throw new NotFoundException('Доска больше недоступна');
    }
    return row;
  }
  checkAccess(access: BoardAccess) { return this.authorize(access, undefined, false, false); }
  publicBoard(row: Awaited<ReturnType<CollaborationService['authorize']>>): Board {
    const { owner_id, share_token, ...board } = row;
    return board;
  }
  async join(request: Request, token: string) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw new NotFoundException('Доска больше недоступна');
    const remote = request.socket.remoteAddress ?? 'unknown';
    const trustedProxy = process.env.TRUST_PROXY === 'loopback' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
    const forwarded = request.headers['x-real-ip'];
    await this.auth.limit('board-join', trustedProxy && typeof forwarded === 'string' ? forwarded : remote, 120, 60);
    const result = await this.db.pool.query('SELECT id FROM boards WHERE share_token=$1', [token]);
    if (!result.rowCount) throw new NotFoundException('Доска больше недоступна');
    const access = { request, boardId: result.rows[0].id as string, token };
    return { access, board: this.publicBoard(await this.authorize(access)) };
  }
  async sharing(request: Request, id: string): Promise<SharingState> {
    const row = await this.authorize({ request, boardId: id });
    return { enabled: !!row.share_token, token: row.share_token };
  }
  async setSharing(request: Request, id: string, enabled: boolean): Promise<SharingState> {
    const result = await this.db.transaction(async client => {
      const row = await this.authorize({ request, boardId: id }, client, true);
      const token = enabled ? row.share_token ?? randomBytes(32).toString('base64url') : null;
      await client.query('UPDATE boards SET share_token=$2, collaborative=collaborative OR $3 WHERE id=$1', [id, token, enabled]);
      await client.query(`INSERT INTO board_assets(board_id,asset_id) SELECT $1,a.id FROM image_assets a
        WHERE a.owner_id=$2 AND a.id IN (SELECT (e->>'assetId')::uuid FROM jsonb_array_elements($3::jsonb) e WHERE e->>'kind'='image') ON CONFLICT DO NOTHING`, [id, row.owner_id, JSON.stringify(row.document.elements)]);
      return { enabled, token };
    });
    this.boards.events.emit('sharing', id);
    return result;
  }
  private async validateBoard(board: Board) {
    await this.validation.transform({ title: board.title, revision: board.revision, document: board.document }, { type: 'body', metatype: UpdateBoardDto });
    if (new Set(board.document.elements.map(e => e.id)).size !== board.document.elements.length || JSON.stringify(board.document).length > 9_000_000) throw new BadRequestException('Слишком большая доска или повторяющиеся объекты');
  }
  async operation(access: BoardAccess, operationId: string, operation: BoardOperation) {
    if (!uuid.test(operationId) || !operation || typeof operation !== 'object' || Object.keys(operation).some(k => !['elements', 'title', 'background'].includes(k)) ||
      !Array.isArray(operation.elements) || operation.elements.length > 10000 || new Set(operation.elements.map(e => e?.id)).size !== operation.elements.length) throw new BadRequestException('Неверная операция');
    for (const change of operation.elements) {
      if (!change || !uuid.test(change.id) || Object.keys(change).some(k => !['id', 'before', 'after'].includes(k)) ||
        change.before === undefined || change.after === undefined || (change.before && change.before.id !== change.id) || (change.after && change.after.id !== change.id)) throw new BadRequestException('Неверный объект');
      for (const side of ['before', 'after'] as const) if (change[side] !== null && (typeof change[side] !== 'object' || Array.isArray(change[side]))) throw new BadRequestException('Неверный объект');
    }
    if (operation.title && (typeof operation.title.before !== 'string' || typeof operation.title.after !== 'string')) throw new BadRequestException('Неверное название');
    for (const key of ['title', 'background'] as const) {
      const value = operation[key];
      if (value && (typeof value !== 'object' || Object.keys(value).some(k => !['before', 'after'].includes(k)) || value.before === undefined || value.after === undefined)) throw new BadRequestException('Неверное изменение');
    }
    // Validate both sides, including objects hidden by conditional conflict handling.
    for (const side of ['before', 'after'] as const) await this.validateBoard({ id: access.boardId, title: operation.title?.[side] ?? 'Доска', revision: 0,
      document: { version: 1, elements: operation.elements.flatMap(e => e[side] ? [e[side]!] : []), ...(operation.background?.[side] ? { background: operation.background[side]! } : {}) } } as Board);
    const saved = await this.db.transaction(async client => {
      const row = await this.authorize(access, client, true);
      if (!row.collaborative) throw new BadRequestException('Совместная работа не включена');
      const duplicate = await client.query('SELECT 1 FROM board_operations WHERE board_id=$1 AND operation_id=$2', [access.boardId, operationId]);
      if (duplicate.rowCount) return { board: this.publicBoard(row), change: undefined as CommittedChange | undefined };
      const board = applyOperation(this.publicBoard(row), operation);
      // Both sides of every changed object were validated above. Revalidating
      // thousands of unchanged DTOs on every pen-up blocks all socket previews.
      if (board.document.elements.length > 10000 || JSON.stringify(board.document).length > 9_000_000) throw new BadRequestException('Слишком большая доска');
      const assets = [...new Set(board.document.elements.flatMap(e => e.kind === 'image' ? [e.assetId] : []))];
      if (assets.length) {
        const found = await client.query(`SELECT id FROM image_assets WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND purpose='board'
          AND ($3::boolean=false OR shared_board_id=$4 OR id IN (SELECT asset_id FROM board_assets WHERE board_id=$4))`,
          [assets, row.owner_id, !!access.token, access.boardId]);
        if (found.rowCount !== assets.length) throw new BadRequestException('Изображение недоступно на этой доске');
        await client.query('INSERT INTO board_assets(board_id,asset_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING', [board.id, assets]);
      }
      const updated = await client.query(`UPDATE boards SET title=$2, document=$3::jsonb, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING revision, updated_at AS "updatedAt"`, [board.id, board.title, JSON.stringify(board.document)]);
      await client.query('INSERT INTO board_operations(board_id,operation_id) VALUES($1,$2)', [board.id, operationId]);
      return { board: { ...board, ...updated.rows[0] } as Board, change: { baseRevision: row.revision, operation: difference(this.publicBoard(row), board) } as CommittedChange };
    });
    if (saved.change) this.boards.events.emit('board', saved.board, operationId, saved.change);
    return saved;
  }
  async preview(access: BoardAccess, element: unknown) {
    await this.checkAccess(access);
    if (element !== null) await this.validateBoard({ title: 'Доска', revision: 0, document: { version: 1, elements: [element] } } as Board);
    // Images are never relayed as previews (avoid bypassing asset authorization).
    if (element && (element as { kind: string }).kind === 'image') throw new BadRequestException('Неверное превью');
  }
  async asset(access: BoardAccess, assetId: string) {
    const row = await this.authorize(access);
    if (!uuid.test(assetId) || !row.document.elements.some(e => e.kind === 'image' && e.assetId === assetId)) throw new NotFoundException('Изображение не найдено');
    return { workspaceId: row.owner_id as string, userId: null };
  }
  async upload(access: BoardAccess) {
    const row = await this.authorize(access);
    await this.auth.limit('board-image-upload', access.boardId, 30, 60);
    return { workspaceId: row.owner_id as string, userId: null };
  }
}
