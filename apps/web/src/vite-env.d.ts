/// <reference types="vite/client" />

declare const __BLUVIBOARD_BUILD_ID__: string;

declare const __BLUVIBOARD_RELEASES__: {
  web: import('./release-notes').ReleaseNotes;
  webHistory: import('./release-notes').ReleaseNotes[];
  desktop: Record<string, import('./release-notes').ReleaseNotes>;
};
