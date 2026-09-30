import { cancelDesktopClose, discardAndClose, isDesktop, requestDesktopClose, useDesktop } from './desktop';

export function DesktopCloseNotice() {
  const { closing, error } = useDesktop();
  if (!isDesktop || (!closing && !error)) return null;
  return <section className="pwa-update desktop-close" aria-label="Закрытие BluviBoard">
    <div role={error ? 'alert' : 'status'}><strong>{closing ? 'Сохраняем доску перед закрытием…' : 'Не удалось сохранить доску'}</strong>
      <p>{error || 'Дождёмся загрузки изображений и сохранения изменений.'}</p></div>
    {error && <div className="pwa-update-actions">
      <button onClick={() => { void requestDesktopClose(); }}>Повторить</button>
      <button onClick={cancelDesktopClose}>Продолжить работу</button>
      <button onClick={() => { void discardAndClose(); }}>Закрыть всё равно</button>
    </div>}
  </section>;
}
