import { Download } from 'lucide-react';
import { isDesktop } from './desktop';
import { PwaInstallButton } from './PwaControls';
import { version } from '../../desktop/package.json';
import { DesktopUpdateButton } from './DesktopControls';
import { ReleaseNotesButton } from './ReleaseNotesControls';

export function InstallControls() {
  if (isDesktop) return <><DesktopUpdateButton /><ReleaseNotesButton /></>;
  const url = `https://github.com/Izarych/interactive-whiteboard/releases/download/desktop-v${version}/BluviBoard-Setup-${version}-x64.exe`;
  return <div className="install-controls">
    <a className="windows-download" href={url} target="_blank" rel="noopener noreferrer"><Download size={16} />Скачать для Windows</a>
    <small className="windows-download-note">Windows 10/11 · x64 · установщик .exe</small>
    <a className="windows-download" href={`https://github.com/Izarych/interactive-whiteboard/releases/download/desktop-v${version}/BluviBoard-${version}-macOS-arm64.dmg`} target="_blank" rel="noopener noreferrer"><Download size={16} />Mac · Apple Silicon</a>
    <a className="windows-download" href={`https://github.com/Izarych/interactive-whiteboard/releases/download/desktop-v${version}/BluviBoard-${version}-macOS-x64.dmg`} target="_blank" rel="noopener noreferrer"><Download size={16} />Mac · Intel</a>
    <small className="windows-download-note">macOS 14+ · установщик .dmg</small>
    <PwaInstallButton />
    <ReleaseNotesButton />
  </div>;
}
