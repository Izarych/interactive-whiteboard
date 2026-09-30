const cache = new Map<string, Promise<HTMLImageElement>>();

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
    image.src = `/api/assets/${assetId}`;
  });
  cache.set(assetId, promise);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return promise;
}
