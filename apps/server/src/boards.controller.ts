import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { CreateBoardDto, UpdateBoardDto } from './boards.dto';
import { AuthGuard } from './auth/auth.guard';
import type { AuthenticatedRequest } from './auth/auth.types';

@Controller('boards')
@UseGuards(AuthGuard)
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) { return this.boards.list(request.auth); }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateBoardDto) { return this.boards.create(request.auth, dto); }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.boards.get(request.auth, id); }

  @Put(':id')
  update(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: UpdateBoardDto) {
    return this.boards.update(request.auth, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.boards.delete(request.auth, id); }
}
