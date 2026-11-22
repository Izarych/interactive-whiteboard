import { Controller, Get, Header, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { DesktopReleaseService } from './desktop-release.service';
import type { DesktopArchitecture, DesktopPlatform } from './desktop-release.service';

class DesktopReleaseQuery {
  @IsOptional()
  @IsIn(['windows', 'macos'])
  platform?: DesktopPlatform;

  @IsOptional()
  @IsIn(['x64', 'arm64'])
  arch?: DesktopArchitecture;
}

@Controller('desktop')
export class DesktopReleaseController {
  constructor(private readonly releases: DesktopReleaseService) {}

  @Get('latest')
  @Header('Cache-Control', 'no-store')
  async latest(@Query() query: DesktopReleaseQuery = {}) {
    const platform = query.platform ?? 'windows';
    return { release: await this.releases.latest(platform, query.arch ?? (platform === 'macos' ? 'arm64' : 'x64')) };
  }
}
