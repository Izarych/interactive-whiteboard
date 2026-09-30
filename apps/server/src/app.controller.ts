import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

@Controller()
export class AppController {
  @Get('health')
  health() {
    let commit = 'development';
    let version = 'development';
    try { version = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).version; } catch { /* Source-mode execution may not have package metadata here. */ }
    try { commit = JSON.parse(readFileSync(resolve(__dirname, '../../../release.json'), 'utf8')).commit; } catch { /* Local development has no release manifest. */ }
    return { status: 'ok', service: 'interactive-whiteboard-api', version, commit };
  }
}
