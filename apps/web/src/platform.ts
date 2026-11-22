declare global {
  interface Window {
    readonly __BLUVIBOARD_DESKTOP__?: boolean;
    readonly __BLUVIBOARD_DESKTOP_VERSION__?: string;
    readonly __BLUVIBOARD_OFFLINE__?: boolean;
    readonly __BLUVIBOARD_PREVIEW__?: boolean;
    readonly __BLUVIBOARD_DESKTOP_OS__?: string;
    readonly __BLUVIBOARD_DESKTOP_ARCH__?: string;
  }
}

export const isDesktop = window.__BLUVIBOARD_DESKTOP__ === true;
export const isOfflineDesktop = isDesktop && window.__BLUVIBOARD_OFFLINE__ === true;
export const isMacDesktop = isDesktop && window.__BLUVIBOARD_DESKTOP_OS__ === 'macos';
export const desktopArch = window.__BLUVIBOARD_DESKTOP_ARCH__ === 'aarch64' ? 'arm64' : 'x64';
// The first Windows release predated the version marker.
export const desktopVersion = window.__BLUVIBOARD_DESKTOP_VERSION__ ?? '0.1.0';
