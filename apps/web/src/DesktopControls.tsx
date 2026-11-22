import { Download, RefreshCw } from 'lucide-react';
import { cancelDesktopClose, checkDesktopUpdates, discardAndClose, dismissDesktopUpdate, downloadDesktopUpdate, isDesktop, newerDesktopVersion, requestDesktopClose, useDesktop } from './desktop';
import { desktopVersion, isMacDesktop } from './platform';
const client = isMacDesktop ? 'macOS-клиент' : 'Windows-клиент';

export function DesktopUpdateButton() {
  const { checking, preparingUpdate, closing } = useDesktop();
  if (!isDesktop) return null;
  return <div className="desktop-update-control"><button className="pwa-install-button" disabled={checking || preparingUpdate || closing} onClick={() => { void checkDesktopUpdates(true); }}>
    <RefreshCw size={15} />{checking ? 'Проверяем обновления…' : 'Проверить обновления'}</button><small>{client} {desktopVersion}</small></div>;
}

export function DesktopUpdateNotice() {
  const { checking, preparingUpdate, latest, updateError, updateVisible } = useDesktop();
  if (!isDesktop || !updateVisible) return null;
  const available = latest && newerDesktopVersion(latest.version);
  return <section className="pwa-update desktop-update" aria-label={isMacDesktop ? 'Обновления macOS-клиента' : 'Обновления Windows-клиента'}>
    <div role={updateError ? 'alert' : 'status'}><strong>{preparingUpdate ? 'Сохраняем доску…' : checking ? 'Проверяем обновления…' : updateError ? 'Обновление отложено' : available ? `Доступен ${client} ${latest.version}` : latest ? 'Установлена актуальная версия' : `${isMacDesktop ? 'macOS' : 'Windows'}-релиз пока недоступен`}</strong>
      <p>{updateError || (available ? `Установлена версия ${desktopVersion}. Скачайте обновление, закройте BluviBoard и запустите установщик. Вход сохранится.` : `${client} ${desktopVersion}`)}</p></div>
    <div className="pwa-update-actions">{available && <button disabled={checking || preparingUpdate} onClick={() => { void downloadDesktopUpdate(); }}><Download size={15} />Скачать обновление</button>}
      {!checking && updateError && <button onClick={() => { void checkDesktopUpdates(true); }}>Повторить проверку</button>}
      <button disabled={preparingUpdate} onClick={dismissDesktopUpdate}>{available ? 'Позже' : 'Закрыть'}</button></div>
  </section>;
}

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
