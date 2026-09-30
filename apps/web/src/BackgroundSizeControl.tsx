import { useEffect, useId, useRef, useState } from 'react';
import type { BoardBackground } from '@whiteboard/shared';
import { MAX_BACKGROUND_SIZE, MIN_BACKGROUND_SIZE } from './background';

export function BackgroundSizeControl({ background, onChange }: {
  background: BoardBackground; onChange: (size: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(background.size));
  const focused = useRef(false);
  const label = background.pattern === 'grid' ? 'Размер клетки' : 'Шаг точек';

  useEffect(() => {
    if (!focused.current) setDraft(String(background.size));
  }, [background.size]);

  const applyDraft = () => {
    focused.current = false;
    const number = draft.trim() ? Number(draft) : background.size;
    const next = Number.isFinite(number)
      ? Math.max(MIN_BACKGROUND_SIZE, Math.min(MAX_BACKGROUND_SIZE, Math.round(number)))
      : background.size;
    setDraft(String(next));
    if (next !== background.size) onChange(next);
  };

  return (
    <div className="background-size">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={MIN_BACKGROUND_SIZE} max={MAX_BACKGROUND_SIZE} step="1" value={background.size}
        onChange={(event) => onChange(Number(event.target.value))} />
      <input className="background-size-value" type="number" aria-label={`${label}: значение`}
        min={MIN_BACKGROUND_SIZE} max={MAX_BACKGROUND_SIZE} step="1" value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          const number = Number(value);
          // Allow intermediate/empty input while typing, without sending invalid settings.
          if (value && Number.isInteger(number) && number >= MIN_BACKGROUND_SIZE && number <= MAX_BACKGROUND_SIZE && number !== background.size) {
            onChange(number);
          }
        }}
        onBlur={applyDraft}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </div>
  );
}
