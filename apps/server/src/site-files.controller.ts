import { Controller, Get, Header } from '@nestjs/common';
import { SiteFilesService } from './site-files.service';

@Controller()
export class SiteFilesController {
  constructor(private readonly files: SiteFilesService) {}

  @Get('robots.txt') @Header('Content-Type', 'text/plain; charset=utf-8')
  async robots() { return (await this.files.read('robots.txt', true)).content; }

  @Get('sitemap.xml') @Header('Content-Type', 'application/xml; charset=utf-8')
  async sitemap() { return (await this.files.read('sitemap.xml', true)).content; }
}
