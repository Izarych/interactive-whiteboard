import { BadRequestException, Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { ToolShortcuts } from '@whiteboard/shared';
import { AuthGuard } from './auth/auth.guard';
import type { AuthenticatedRequest } from './auth/auth.types';
import { DatabaseService } from './database.service';
import { UpdateToolPanelDto, UpdateToolShortcutsDto } from './tool-shortcuts.dto';

@Controller('preferences/tools')
@UseGuards(AuthGuard)
export class ToolShortcutsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('panel')
  async panel(@Req() request: AuthenticatedRequest): Promise<{ pinned: boolean }> {
    const result = await this.db.pool.query('SELECT tool_panel_pinned FROM workspace_owners WHERE id=$1', [request.auth.workspaceId]);
    return { pinned: result.rows[0].tool_panel_pinned === true };
  }

  @Put('panel')
  async updatePanel(@Req() request: AuthenticatedRequest, @Body() dto: UpdateToolPanelDto): Promise<{ pinned: boolean }> {
    const result = await this.db.pool.query('UPDATE workspace_owners SET tool_panel_pinned=$2 WHERE id=$1 RETURNING tool_panel_pinned', [request.auth.workspaceId, dto.pinned]);
    return { pinned: result.rows[0].tool_panel_pinned };
  }

  @Get()
  async get(@Req() request: AuthenticatedRequest): Promise<{ shortcuts: ToolShortcuts }> {
    const result = await this.db.pool.query('SELECT tool_shortcuts FROM workspace_owners WHERE id=$1', [request.auth.workspaceId]);
    return { shortcuts: result.rows[0].tool_shortcuts };
  }

  @Put()
  async update(@Req() request: AuthenticatedRequest, @Body() dto: UpdateToolShortcutsDto): Promise<{ shortcuts: ToolShortcuts }> {
    const used = new Set<string>();
    const shortcuts: ToolShortcuts = {};
    for (const [tool, shortcut] of Object.entries(dto.shortcuts)) {
      if (shortcut === undefined) continue;
      if (!shortcut) throw new BadRequestException('Для удаления хоткея уберите инструмент из настроек');
      if ((shortcut.ctrl || shortcut.meta) && ['KeyZ', 'KeyY', 'KeyV'].includes(shortcut.code)) {
        throw new BadRequestException('Сочетания отмены, повтора и вставки уже используются доской');
      }
      const key = JSON.stringify([shortcut.code, shortcut.ctrl, shortcut.alt, shortcut.shift, shortcut.meta]);
      if (used.has(key)) throw new BadRequestException('Один хоткей нельзя назначить нескольким инструментам');
      used.add(key);
      shortcuts[tool as keyof ToolShortcuts] = shortcut;
    }
    const result = await this.db.pool.query('UPDATE workspace_owners SET tool_shortcuts=$2::jsonb WHERE id=$1 RETURNING tool_shortcuts', [request.auth.workspaceId, JSON.stringify(shortcuts)]);
    return { shortcuts: result.rows[0].tool_shortcuts };
  }
}
