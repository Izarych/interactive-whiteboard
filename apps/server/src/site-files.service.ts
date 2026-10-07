import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SiteFile, SiteFileName } from '@whiteboard/shared';
import { UpdateSiteFileDto } from './site-files.dto';

@Injectable()
export class SiteFilesService {
  private readonly directory: string;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(config: ConfigService) {
    this.directory = resolve(config.get<string>('SITE_FILES_PATH', './data/site-files'));
  }
  name(value: string): SiteFileName {
    if (value !== 'robots.txt' && value !== 'sitemap.xml') throw new NotFoundException('Файл не найден');
    return value;
  }
  async read(value: string, required = false): Promise<SiteFile> {
    const name = this.name(value);
    try {
      const content = await readFile(join(this.directory, name), 'utf8');
      return { name, content, revision: createHash('sha256').update(content).digest('hex') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (required) throw new NotFoundException('Файл ещё не создан');
      return { name, content: '', revision: null };
    }
  }
  async list() { return Promise.all(['robots.txt', 'sitemap.xml'].map((name) => this.read(name))); }
  update(value: string, dto: UpdateSiteFileDto): Promise<SiteFile> {
    const name = this.name(value);
    const operation = this.writes.then(async () => {
      if (Buffer.byteLength(dto.content, 'utf8') > 1048576 || dto.content.includes('\0')) throw new BadRequestException('Файл должен быть текстовым и не больше 1 МБ');
      if (name === 'sitemap.xml') {
        const valid = XMLValidator.validate(dto.content);
        if (valid !== true) throw new BadRequestException(`Некорректный XML: ${valid.err.msg}`);
        const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(dto.content);
        const root = parsed.urlset ?? parsed.sitemapindex;
        if (!root || root['@_xmlns'] !== 'http://www.sitemaps.org/schemas/sitemap/0.9') {
          throw new BadRequestException('Sitemap должен содержать urlset или sitemapindex с пространством имён sitemaps.org');
        }
      }
      const previous = await this.read(name);
      if (previous.revision !== dto.revision) throw new ConflictException('Файл изменился. Загрузите актуальную версию перед сохранением.');
      await mkdir(this.directory, { recursive: true });
      const temporary = join(this.directory, `.${name}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, dto.content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
        // Nginx reads these public files under a different service account.
        await chmod(temporary, 0o644);
        await rename(temporary, join(this.directory, name));
      } finally { await rm(temporary, { force: true }); }
      return this.read(name);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
