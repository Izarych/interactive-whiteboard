import { Body, Controller, Get, Param, Post, Put, Req, UploadedFile, UseInterceptors, BadRequestException, Res, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CollaborationService } from './collaboration.service';
import { AssetsService, MAX_IMAGE_BYTES } from './assets.service';
import { DatabaseService } from './database.service';

@Controller('collaboration')
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService, private readonly assets: AssetsService, private readonly db: DatabaseService) {}
  private access(request: Request, boardId: string) {
    const token = request.headers['x-board-token'];
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw new BadRequestException('Неверная ссылка');
    return { request, boardId, token };
  }
  @Get(':id/sharing')
  sharing(@Req() request: Request, @Param('id') id: string) { return this.collaboration.sharing(request, id); }
  @Put(':id/sharing')
  setSharing(@Req() request: Request, @Param('id') id: string, @Body() body: { enabled: boolean }) {
    if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') throw new BadRequestException('Неверная настройка');
    return this.collaboration.setSharing(request, id, body.enabled);
  }
  @Get(':id/assets/:assetId')
  @Header('Cache-Control', 'private, no-store')
  async image(@Req() request: Request, @Param('id') id: string, @Param('assetId') assetId: string, @Res({ passthrough: true }) response: Response) {
    const access = this.access(request, id);
    const file = await this.assets.get(await this.collaboration.asset(access, assetId), assetId);
    await this.collaboration.authorize(access);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return file;
  }
  @Post(':id/assets')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 } }))
  async upload(@Req() request: Request, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    const access = this.access(request, id);
    const owner = await this.collaboration.upload(access);
    const asset = await this.assets.upload(owner, file);
    await this.collaboration.authorize(access);
    await this.db.pool.query('UPDATE image_assets SET shared_board_id=$2 WHERE id=$1', [asset.id, id]);
    return asset;
  }
}
