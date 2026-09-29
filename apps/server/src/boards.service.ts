import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Board, BoardSummary } from '@whiteboard/shared';
import { DatabaseService } from './database.service';
import { CreateBoardDto, UpdateBoardDto } from './boards.dto';

const summaryColumns = `id, title, revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

@Injectable()
export class BoardsService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<BoardSummary[]> {
    const result = await this.db.pool.query(`SELECT ${summaryColumns} FROM boards ORDER BY updated_at DESC, id`);
    return result.rows;
  }

  async create(dto: CreateBoardDto): Promise<Board> {
    const result = await this.db.pool.query(
      `INSERT INTO boards (id, title) VALUES ($1, $2) RETURNING ${summaryColumns}, document`,
      [randomUUID(), dto.title],
    );
    return result.rows[0];
  }

  async get(id: string): Promise<Board> {
    const result = await this.db.pool.query(`SELECT ${summaryColumns}, document FROM boards WHERE id = $1`, [id]);
    if (!result.rowCount) throw new NotFoundException('Доска не найдена');
    return result.rows[0];
  }

  async update(id: string, dto: UpdateBoardDto): Promise<Board> {
    const assetIds = [...new Set(dto.document.elements.flatMap((element) => element.kind === 'image' ? [element.assetId] : []))];
    if (assetIds.length) {
      const assets = await this.db.pool.query('SELECT id FROM image_assets WHERE id = ANY($1::uuid[])', [assetIds]);
      if (assets.rowCount !== assetIds.length) throw new BadRequestException('Одно из изображений не найдено. Загрузите его заново.');
    }
    const result = await this.db.pool.query(
      `UPDATE boards SET title = $2, document = $3::jsonb, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $4 RETURNING ${summaryColumns}, document`,
      [id, dto.title, JSON.stringify(dto.document), dto.revision],
    );
    if (!result.rowCount) {
      await this.get(id);
      throw new ConflictException('Доска изменена в другой вкладке. Сохраните копию или перезагрузите доску.');
    }
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.pool.query('DELETE FROM boards WHERE id = $1', [id]);
    if (!result.rowCount) throw new NotFoundException('Доска не найдена');
  }
}
