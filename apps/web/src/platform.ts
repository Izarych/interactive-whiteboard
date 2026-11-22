declare global {
  interface Window {
    readonly __BLUVIBOARD_DESKTOP__?: boolean;
    readonly __BLUVIBOARD_DESKTOP_VERSION__?: string;
    readonly __BLUVIBOARD_OFFLINE__?: boolean;
  }
}

export const isDesktop = window.__BLUVIBOARD_DESKTOP__ === true;
export const isOfflineDesktop = isDesktop && window.__BLUVIBOARD_OFFLINE__ === true;
// The first Windows release predated the version marker.
export const desktopVersion = window.__BLUVIBOARD_DESKTOP_VERSION__ ?? '0.1.0';
