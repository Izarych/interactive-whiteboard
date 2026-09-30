import { Controller, Get, Header } from '@nestjs/common';
import { DesktopReleaseService } from './desktop-release.service';

@Controller('desktop')
export class DesktopReleaseController {
  constructor(private readonly releases: DesktopReleaseService) {}

  @Get('latest')
  @Header('Cache-Control', 'no-store')
  async latest() { return { release: await this.releases.latest() }; }
}
