import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

export interface StoredFile {
  provider: 'local' | 's3';
  bucket: string | null;
  key: string;
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  readonly provider: StoredFile['provider'];
  private readonly directory: string;
  private s3?: S3Client;

  constructor(private readonly config: ConfigService) {
    const provider = config.get<string>('STORAGE_PROVIDER', 'local');
    if (provider !== 'local' && provider !== 's3') throw new Error('STORAGE_PROVIDER must be local or s3');
    this.provider = provider;
    this.directory = resolve(config.get<string>('STORAGE_LOCAL_PATH', './data/uploads'));
    if (provider === 's3') {
      config.getOrThrow<string>('S3_BUCKET');
      this.client();
    }
  }

  private client() {
    this.s3 ??= new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT', 'https://storage.yandexcloud.net'),
      region: this.config.get<string>('S3_REGION', 'ru-central1'),
      forcePathStyle: true,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    });
    return this.s3;
  }

  async write(key: string, data: Buffer): Promise<StoredFile> {
    if (this.provider === 's3') {
      const bucket = this.config.getOrThrow<string>('S3_BUCKET');
      await this.client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: 'image/png' }));
      return { provider: 's3', bucket, key };
    }
    await mkdir(this.directory, { recursive: true });
    await writeFile(resolve(this.directory, key), data, { flag: 'wx' });
    return { provider: 'local', bucket: null, key };
  }

  async read(file: StoredFile): Promise<Readable> {
    if (file.provider === 's3') {
      if (!file.bucket) throw new Error('S3 asset has no bucket');
      const result = await this.client().send(new GetObjectCommand({ Bucket: file.bucket, Key: file.key }));
      if (!(result.Body instanceof Readable)) throw new Error('S3 returned no image stream');
      return result.Body;
    }
    const location = resolve(this.directory, file.key);
    await stat(location);
    return createReadStream(location);
  }

  async remove(file: StoredFile): Promise<void> {
    if (file.provider === 's3') {
      await this.client().send(new DeleteObjectCommand({ Bucket: file.bucket!, Key: file.key }));
    } else {
      await unlink(resolve(this.directory, file.key));
    }
  }

  onModuleDestroy() { this.s3?.destroy(); }
}
