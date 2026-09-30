import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AssetsService, MAX_IMAGE_BYTES } from './assets.service';
import type { Response } from 'express';
import { AuthGuard } from './auth/auth.guard';
import type { AuthenticatedRequest } from './auth/auth.types';

@Controller('assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  }))
  upload(@Req() request: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) { return this.assets.upload(request.auth, file); }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 } }))
  avatar(@Req() request: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) { return this.assets.upload(request.auth, file, 'avatar'); }

  @Get(':id')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res({ passthrough: true }) response: Response) {
    const image = await this.assets.get(request.auth, id);
    response.setHeader('Cache-Control', 'private, no-store');
    return image;
  }
}
