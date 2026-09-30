declare global {
  interface Window {
    readonly __BLUVIBOARD_DESKTOP__?: boolean;
  }
}

export const isDesktop = window.__BLUVIBOARD_DESKTOP__ === true;
