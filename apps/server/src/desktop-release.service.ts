import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DesktopRelease } from '@whiteboard/shared';

const repository = 'https://github.com/Izarych/interactive-whiteboard';
const versionPattern = /^desktop-v(\d+\.\d+\.\d+)$/;

export type DesktopPlatform = 'windows' | 'macos';
export type DesktopArchitecture = 'x64' | 'arm64';
export function latestDesktopRelease(data: unknown, platform: DesktopPlatform = 'windows', arch: DesktopArchitecture = 'x64'): DesktopRelease | null {
  if (!Array.isArray(data)) throw new Error('Invalid release response');
  if (!['windows', 'macos'].includes(platform) || !['x64', 'arm64'].includes(arch) || (platform === 'windows' && arch !== 'x64')) return null;
  const candidates: DesktopRelease[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object' || value.draft !== false || value.prerelease !== false || typeof value.tag_name !== 'string') continue;
    const version = versionPattern.exec(value.tag_name)?.[1];
    if (!version || !version.split('.').every((part) => Number.isSafeInteger(Number(part)))) continue;
    const name = platform === 'macos' ? `BluviBoard-${version}-macOS-${arch}.dmg` : `BluviBoard-Setup-${version}-x64.exe`;
    const downloadUrl = `${repository}/releases/download/${value.tag_name}/${name}`;
    if (!Array.isArray(value.assets) || !value.assets.some((asset: unknown) => {
      if (!asset || typeof asset !== 'object') return false;
      const item = asset as Record<string, unknown>;
      return item.name === name && item.state === 'uploaded' && typeof item.size === 'number' && item.size > 0 && item.browser_download_url === downloadUrl;
    })) continue;
    candidates.push({ version, downloadUrl, releaseUrl: `${repository}/releases/tag/${value.tag_name}` });
  }
  candidates.sort((a, b) => {
    const first = a.version.split('.').map(Number), second = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (first[i] !== second[i]) return second[i] - first[i];
    return 0;
  });
  return candidates[0] ?? null;
}

@Injectable()
export class DesktopReleaseService {
  private cached: { data: unknown; expires: number } | null = null;
  private inFlight: Promise<unknown> | null = null;
  private retryAfter = 0;

  latest(platform: DesktopPlatform = 'windows', arch: DesktopArchitecture = 'x64'): Promise<DesktopRelease | null> {
    const select = (data: unknown) => latestDesktopRelease(data, platform, arch);
    if (this.cached && this.cached.expires > Date.now()) return Promise.resolve(select(this.cached.data));
    if (this.inFlight) return this.inFlight.then(select);
    if (this.retryAfter > Date.now()) return Promise.reject(new ServiceUnavailableException('Не удалось проверить обновления. Попробуйте ещё раз через минуту.'));
    this.inFlight = this.fetchLatest().finally(() => { this.inFlight = null; });
    return this.inFlight.then(select);
  }

  private async fetchLatest(): Promise<unknown> {
    try {
      const response = await fetch('https://api.github.com/repos/Izarych/interactive-whiteboard/releases?per_page=100', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BluviBoard-update-check', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Release service unavailable');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid release response');
      this.cached = { data, expires: Date.now() + 5 * 60 * 1000 };
      return data;
    } catch {
      this.retryAfter = Date.now() + 30000;
      throw new ServiceUnavailableException('Не удалось проверить обновления. Проверьте подключение и попробуйте снова.');
    }
  }
}
