import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException, StreamableFile } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp = require('sharp');
import type { ImageAsset } from '@whiteboard/shared';
import { DatabaseService } from './database.service';
import { StorageService } from './storage.service';
import type { StoredFile } from './storage.service';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  constructor(private readonly db: DatabaseService, private readonly storage: StorageService) {}

  async upload(file?: Express.Multer.File): Promise<ImageAsset> {
    if (!file) throw new BadRequestException('Выберите изображение');
    let result: { data: Buffer; info: sharp.OutputInfo };
    try {
      const image = sharp(file.buffer, { limitInputPixels: 25000000 });
      const metadata = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
        throw new Error('Unsupported format');
      }
      result = await image.rotate().png().toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('Не удалось прочитать изображение. Используйте PNG, JPEG или WebP до 25 мегапикселей.');
    }
    const { data, info } = result;
    if (data.length > MAX_IMAGE_BYTES || info.width > 10000 || info.height > 10000) {
      throw new BadRequestException('Изображение слишком большое: до 10 МБ и 10 000 пикселей по каждой стороне.');
    }
    const id = randomUUID();
    let stored: StoredFile;
    try {
      stored = await this.storage.write(`${id}.png`, data);
    } catch (error) {
      this.logger.error('Image storage write failed', error);
      throw new ServiceUnavailableException('Не удалось загрузить изображение. Попробуйте ещё раз.');
    }
    try {
      await this.db.pool.query(
        `INSERT INTO image_assets (id, storage_provider, storage_bucket, storage_key, width, height, size)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, stored.provider, stored.bucket, stored.key, info.width, info.height, data.length],
      );
    } catch (error) {
      await this.storage.remove(stored).catch((reason) => this.logger.error('Image rollback failed', reason));
      throw error;
    }
    return { id, url: `/api/assets/${id}`, width: info.width, height: info.height };
  }

  async get(id: string): Promise<StreamableFile> {
    const result = await this.db.pool.query(
      `SELECT storage_provider AS provider, storage_bucket AS bucket, storage_key AS key, size FROM image_assets WHERE id = $1`, [id],
    );
    if (!result.rowCount) throw new NotFoundException('Изображение не найдено');
    const file = result.rows[0] as StoredFile & { size: number };
    try {
      return new StreamableFile(await this.storage.read(file), { type: 'image/png', length: file.size });
    } catch (error) {
      this.logger.error('Image storage read failed', error);
      throw new ServiceUnavailableException('Изображение временно недоступно');
    }
  }
}
