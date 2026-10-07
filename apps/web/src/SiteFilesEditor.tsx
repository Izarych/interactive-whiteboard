import { useCallback, useEffect, useState } from 'react';
import type { SiteFile, SiteFileName } from '@whiteboard/shared';
import { adminApi } from './adminApi';
import { errorMessage } from './api';

export function SiteFilesEditor() {
  const [files, setFiles] = useState<SiteFile[]>([]);
  const [selected, setSelected] = useState<SiteFileName>('robots.txt');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError(''); setNotice('');
    try { setFiles(await adminApi.siteFiles()); } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const file = files.find((item) => item.name === selected);
  const save = async () => {
    if (!file || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await adminApi.saveSiteFile(file.name, file.content, file.revision);
      setFiles((previous) => previous.map((item) => item.name === result.name ? result : item));
      setNotice(`${result.name} сохранён`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <section className="admin-card site-files-editor">
    <div className="admin-card-heading"><div><h2>Файлы сайта</h2><p>Файлы хранятся на сервере отдельно от сборок приложения.</p></div>
      <button className="admin-secondary" disabled={loading || busy} onClick={() => { void load(); }}>Загрузить с сервера</button></div>
    <div className="site-file-tabs" role="group" aria-label="Файлы сайта">{(['robots.txt', 'sitemap.xml'] as const).map((name) => <button key={name} className={selected === name ? 'active' : ''} disabled={busy} aria-pressed={selected === name} onClick={() => { setSelected(name); setError(''); setNotice(''); }}>{name}</button>)}</div>
    {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="form-notice" role="status">{notice}</div>}
    {loading ? <p className="admin-empty">Загружаем файлы…</p> : file && <>
      {file.revision === null && <p className="drawing-settings-note">Файл ещё не создан. Введите содержимое и сохраните.</p>}
      <label className="form-label">Содержимое {file.name}<textarea aria-label={`Содержимое ${file.name}`} spellCheck={false} maxLength={1048576} disabled={busy} value={file.content} onChange={(event) => {
        const content = event.target.value; setNotice('');
        setFiles((previous) => previous.map((item) => item.name === selected ? { ...item, content } : item));
      }} /></label>
      <div className="site-file-actions"><button className="primary-button" disabled={busy} onClick={() => { void save(); }}>{busy ? 'Сохранение…' : 'Сохранить файл'}</button>
        <a className="admin-secondary" href={`/${file.name}`} target="_blank" rel="noreferrer">Открыть опубликованный файл</a></div>
    </>}
  </section>;
}
