import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AssetsService, MAX_IMAGE_BYTES } from './assets.service';
import type { Response } from 'express';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  }))
  upload(@UploadedFile() file?: Express.Multer.File) { return this.assets.upload(file); }

  @Get(':id')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res({ passthrough: true }) response: Response) {
    const image = await this.assets.get(id);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return image;
  }
}
