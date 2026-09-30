import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { applyPwaUpdate, deferPwaUpdate, installPwa, usePwa } from './pwa';

export function PwaInstallButton() {
  const { installed, installPrompt, installing } = usePwa();
  const [help, setHelp] = useState(false);
  if (installed) return null;
  return <div className="pwa-install">
    <button className="pwa-install-button" disabled={installing} onClick={() => {
      if (installPrompt) void installPwa().catch(() => setHelp(true));
      else setHelp((previous) => !previous);
    }}><Download size={16} />{installing ? 'Устанавливаем…' : 'Установить BluviBoard'}</button>
    {help && <section className="pwa-install-help" aria-label="Как установить BluviBoard">
      <p>На Windows откройте сайт в Chrome или Edge и выберите «Установить приложение» в меню браузера или значок установки в адресной строке.</p>
      <p>На iPhone или iPad: Safari → «Поделиться» → «На экран Домой». Если установка недоступна, продолжайте работать в браузере.</p>
      <button onClick={() => setHelp(false)}>Понятно</button>
    </section>}
  </div>;
}

export function PwaUpdateNotice() {
  const { waiting, updating, deferred, error } = usePwa();
  if (!waiting || deferred) return null;
  return <section className="pwa-update" aria-label="Обновление BluviBoard">
    <div role={error ? 'alert' : 'status'}><strong>{updating ? 'Сохраняем доску и обновляем…' : 'Доступна новая версия BluviBoard'}</strong>
      <p>{error || 'Сохраним доску и перезапустим приложение.'}</p></div>
    <div className="pwa-update-actions"><button disabled={updating} onClick={() => { void applyPwaUpdate(); }}><RefreshCw size={15} />Обновить</button>
      <button disabled={updating} onClick={deferPwaUpdate}>Позже</button></div>
  </section>;
}
