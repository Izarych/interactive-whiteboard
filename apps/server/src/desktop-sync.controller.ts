import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsUUID, Min } from 'class-validator';
import { AuthGuard } from './auth/auth.guard';
import type { AuthenticatedRequest } from './auth/auth.types';
import { DatabaseService } from './database.service';
import { BoardsService } from './boards.service';
import { UpdateBoardDto } from './boards.dto';

class DesktopSaveDto extends UpdateBoardDto {
  @IsUUID('4')
  operationId: string;
}
class DesktopDeleteDto {
  @IsInt()
  @Min(0)
  revision: number;
}
const columns = `id, title, document, revision, collaborative, created_at AS "createdAt", updated_at AS "updatedAt"`;

@Controller('desktop')
@UseGuards(AuthGuard)
export class DesktopSyncInfoController {
  @Get('sync-capabilities')
  capabilities() { return { protocol: 1, conflicts: 'preserve-both', collaborative: 'copy-on-edit' }; }
}

// Full snapshots are intentionally limited to non-collaborative boards.
// Stale/offline copies must never replace a newer or actively shared document.
@Controller('desktop/boards')
@UseGuards(AuthGuard)
export class DesktopSyncController {
  constructor(private readonly db: DatabaseService, private readonly boards: BoardsService) {}

  @Put(':id')
  async save(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: DesktopSaveDto) {
    if (!request.auth.userId) throw new ForbiddenException('Для синхронизации войдите в аккаунт');
    if (new Set(dto.document.elements.map(e => e.id)).size !== dto.document.elements.length || JSON.stringify(dto.document).length > 9_000_000) {
      throw new BadRequestException('Слишком большая доска или повторяющиеся объекты');
    }
    return this.db.transaction(async client => {
      // Serialize first creates, including retries with the same client-generated ID.
      const owner = await client.query('SELECT id FROM workspace_owners WHERE id=$1 AND merged_into_id IS NULL AND blocked_at IS NULL FOR UPDATE', [request.auth.workspaceId]);
      if (!owner.rowCount) throw new ForbiddenException('Аккаунт недоступен');
      const current = await client.query(`SELECT ${columns}, owner_id FROM boards WHERE id=$1 FOR UPDATE`, [id]);
      const row = current.rows[0];
      if (row && row.owner_id !== request.auth.workspaceId) throw new NotFoundException('Доска не найдена');
      const duplicate = await client.query('SELECT board_id FROM desktop_sync_operations WHERE owner_id=$1 AND operation_id=$2', [request.auth.workspaceId, dto.operationId]);
      if (duplicate.rowCount) {
        if (duplicate.rows[0].board_id !== id) throw new BadRequestException('Идентификатор операции уже использован');
        // Receipts outlive a board: a lost create acknowledgement must not resurrect
        // a board that another client subsequently deleted.
        if (!row) throw new NotFoundException('Доска удалена на сайте');
        const { owner_id, ...board } = row; return board;
      }
      if (row) {
        if (row.collaborative || row.revision !== dto.revision) throw new ConflictException('Облачная доска изменилась. Сохраните оффлайн-изменения отдельной копией.');
      } else if (dto.revision !== 0) throw new NotFoundException('Доска удалена на сайте');
      const assets = [...new Set(dto.document.elements.flatMap(e => e.kind === 'image' ? [e.assetId] : []))];
      if (assets.length) {
        const found = await client.query(`SELECT id FROM image_assets WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND purpose='board' FOR KEY SHARE`, [assets, request.auth.workspaceId]);
        if (found.rowCount !== assets.length) throw new BadRequestException('Изображение недоступно');
      }
      const saved = row
        ? await client.query(`UPDATE boards SET title=$2, document=$3::jsonb, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING ${columns}`, [id, dto.title, JSON.stringify(dto.document)])
        : await client.query(`INSERT INTO boards(id,title,document,owner_id,revision) VALUES($1,$2,$3::jsonb,$4,1) RETURNING ${columns}`, [id, dto.title, JSON.stringify(dto.document), request.auth.workspaceId]);
      await client.query('INSERT INTO desktop_sync_operations(owner_id,operation_id,board_id) VALUES($1,$2,$3)', [request.auth.workspaceId, dto.operationId, id]);
      return saved.rows[0];
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: DesktopDeleteDto) {
    if (!request.auth.userId) throw new ForbiddenException('Для синхронизации войдите в аккаунт');
    const removed = await this.db.transaction(async client => {
      const result = await client.query('SELECT revision, collaborative FROM boards WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, request.auth.workspaceId]);
      if (!result.rowCount) return false; // A lost successful response is safe to retry.
      if (result.rows[0].collaborative || result.rows[0].revision !== dto.revision) throw new ConflictException('Доска изменилась на сайте и не была удалена');
      await client.query('DELETE FROM boards WHERE id=$1 AND owner_id=$2', [id, request.auth.workspaceId]);
      return true;
    });
    if (removed) this.boards.events.emit('revoked', id);
  }
}
