import { isMacDesktop } from './platform';

export async function saveFile(blob: Blob, filename: string) {
  const name = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  if (isMacDesktop) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Не удалось прочитать файл для экспорта'));
      reader.readAsDataURL(blob);
    });
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('desktop_save_file', { name, data });
    return;
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
