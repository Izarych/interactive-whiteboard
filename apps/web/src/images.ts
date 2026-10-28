const cache = new Map<string, Promise<HTMLImageElement>>();
let sharedAccess: { boardId: string; token: string } | null = null;
export function setSharedImageAccess(access: typeof sharedAccess) { clearImageCache(); sharedAccess = access; }

export function clearImageCache() { cache.clear(); }

export function loadImage(assetId: string): Promise<HTMLImageElement> {
  const existing = cache.get(assetId);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      cache.delete(assetId);
      reject(new Error('Не удалось открыть изображение. Попробуйте обновить доску.'));
    };
    // Both local and cloud images are served through the same-origin API.
    const access = sharedAccess;
    if (access) {
      void fetch(`/api/collaboration/${access.boardId}/assets/${assetId}`, { headers: { 'X-Board-Token': access.token }, cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error('Изображение недоступно');
        const url = URL.createObjectURL(await response.blob());
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); cache.delete(assetId); reject(new Error('Изображение недоступно')); };
        image.src = url;
      }).catch(reason => { cache.delete(assetId); reject(reason); });
    } else image.src = `/api/assets/${assetId}`;
  });
  cache.set(assetId, promise);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return promise;
}
