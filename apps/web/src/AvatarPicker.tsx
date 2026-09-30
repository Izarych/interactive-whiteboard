import { useEffect, useRef, useState } from 'react';

export function AvatarPicker({ name, file, imageUrl, onChange, onRemove, onError }: {
  name: string; file: File | null; imageUrl?: string | null;
  onChange: (file: File) => void; onRemove: () => void; onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const url = preview ?? imageUrl;
  return <div className="avatar-picker">
    <div className="avatar-preview">{url ? <img src={url} alt="Аватар" /> : <span>{Array.from(name.trim())[0]?.toUpperCase() || 'B'}</span>}</div>
    <div><button type="button" className="text-button" onClick={() => input.current?.click()}>{url ? 'Заменить аватар' : 'Загрузить аватар'}</button>
      <small>Необязательно · PNG, JPEG, WebP</small>
      {(file || imageUrl) && <button type="button" className="avatar-remove" onClick={onRemove}>Убрать аватар</button>}
    </div>
    <input ref={input} className="image-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Файл аватара"
      onChange={(event) => {
        const selected = event.target.files?.[0];
        event.target.value = '';
        if (!selected) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
          onError('Выберите PNG, JPEG или WebP размером до 10 МБ.'); return;
        }
        onChange(selected);
      }} />
  </div>;
}
