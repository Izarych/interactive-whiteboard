import type { BoardBackground } from '@whiteboard/shared';

export const DEFAULT_BACKGROUND: BoardBackground = { pattern: 'dots', size: 24 };
export const MIN_BACKGROUND_SIZE = 12;
export const MAX_BACKGROUND_SIZE = 96;

export const backgroundPatterns: { id: BoardBackground['pattern']; label: string }[] = [
  { id: 'plain', label: 'Чистый' },
  { id: 'dots', label: 'Точки' },
  { id: 'grid', label: 'Клетка' },
];

export const backgroundImages: Record<BoardBackground['pattern'], string> = {
  plain: 'none',
  dots: 'radial-gradient(circle, #ccd7e7 1px, transparent 1px)',
  grid: 'linear-gradient(to right, #d7e2f0 1px, transparent 1px), linear-gradient(to bottom, #d7e2f0 1px, transparent 1px)',
};
