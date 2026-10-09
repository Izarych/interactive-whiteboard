/// <reference types="vite/client" />

declare const __BLUVIBOARD_RELEASES__: {
  web: import('./release-notes').ReleaseNotes;
  desktop: Record<string, import('./release-notes').ReleaseNotes>;
};
