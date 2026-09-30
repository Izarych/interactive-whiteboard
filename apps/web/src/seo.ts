import { useEffect } from 'react';

export const PUBLIC_TITLE = 'BluviBoard — онлайн-доска для рисования и заметок';

export function usePageMetadata(privatePage: boolean, admin: boolean) {
  useEffect(() => {
    document.title = admin ? 'BluviBoard — админ-панель' : PUBLIC_TITLE;
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); }
    robots.content = privatePage ? 'noindex, nofollow' : 'index, follow';
  }, [privatePage, admin]);
}
