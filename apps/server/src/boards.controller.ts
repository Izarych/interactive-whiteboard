import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { CreateBoardDto, UpdateBoardDto } from './boards.dto';

@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  list() { return this.boards.list(); }

  @Post()
  create(@Body() dto: CreateBoardDto) { return this.boards.create(dto); }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.boards.get(id); }

  @Put(':id')
  update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: UpdateBoardDto) {
    return this.boards.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.boards.delete(id); }
}
