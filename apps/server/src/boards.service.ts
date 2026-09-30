import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Board, BoardSummary } from '@whiteboard/shared';
import { DatabaseService } from './database.service';
import { CreateBoardDto, UpdateBoardDto } from './boards.dto';
import type { AuthContext } from './auth/auth.types';

const summaryColumns = `id, title, revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

@Injectable()
export class BoardsService {
  constructor(private readonly db: DatabaseService) {}

  async list(owner: AuthContext): Promise<BoardSummary[]> {
    const result = await this.db.pool.query(`SELECT ${summaryColumns} FROM boards WHERE owner_id = $1 ORDER BY updated_at DESC, id`, [owner.workspaceId]);
    return result.rows;
  }

  async create(owner: AuthContext, dto: CreateBoardDto): Promise<Board> {
    const result = await this.db.pool.query(
      `WITH owner AS (SELECT id FROM workspace_owners WHERE id = $3 AND merged_into_id IS NULL FOR UPDATE)
       INSERT INTO boards (id, title, owner_id) SELECT $1, $2, id FROM owner RETURNING ${summaryColumns}, document`,
      [randomUUID(), dto.title, owner.workspaceId],
    );
    if (!result.rowCount) throw new UnauthorizedException('Сессия изменилась. Обновите страницу.');
    await this.db.event('board_created', owner.workspaceId, owner.userId);
    return result.rows[0];
  }

  async get(owner: AuthContext, id: string): Promise<Board> {
    const result = await this.db.pool.query(`SELECT ${summaryColumns}, document FROM boards WHERE id = $1 AND owner_id = $2`, [id, owner.workspaceId]);
    if (!result.rowCount) throw new NotFoundException('Доска не найдена');
    return result.rows[0];
  }

  async update(owner: AuthContext, id: string, dto: UpdateBoardDto): Promise<Board> {
    return this.db.transaction(async (client) => {
      const assetIds = [...new Set(dto.document.elements.flatMap((element) => element.kind === 'image' ? [element.assetId] : []))];
      if (assetIds.length) {
        const assets = await client.query('SELECT id FROM image_assets WHERE id = ANY($1::uuid[]) AND owner_id = $2 FOR KEY SHARE', [assetIds, owner.workspaceId]);
        if (assets.rowCount !== assetIds.length) throw new BadRequestException('Одно из изображений не найдено. Загрузите его заново.');
      }
      const result = await client.query(
        `UPDATE boards SET title = $2, document = $3::jsonb, revision = revision + 1, updated_at = now()
         WHERE id = $1 AND revision = $4 AND owner_id = $5 RETURNING ${summaryColumns}, document`,
        [id, dto.title, JSON.stringify(dto.document), dto.revision, owner.workspaceId],
      );
      if (!result.rowCount) {
        const exists = await client.query('SELECT id FROM boards WHERE id=$1 AND owner_id=$2', [id, owner.workspaceId]);
        if (!exists.rowCount) throw new NotFoundException('Доска не найдена');
        throw new ConflictException('Доска изменена в другой вкладке. Сохраните копию или перезагрузите доску.');
      }
      return result.rows[0];
    });
  }

  async delete(owner: AuthContext, id: string): Promise<void> {
    const result = await this.db.pool.query('DELETE FROM boards WHERE id = $1 AND owner_id = $2', [id, owner.workspaceId]);
    if (!result.rowCount) throw new NotFoundException('Доска не найдена');
  }
}
