import type { Board, BoardDocument, DrawingElement } from '@whiteboard/shared';
import { createLocalBoard, localAssets, localChanged, localProfile, recordKey } from './offline-store';
import type { LocalAsset } from './offline-store';
import { imageBase64, imageBlob } from './offline-cloud';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const number = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validateLocalDocument(value: unknown): asserts value is BoardDocument {
  if (!value || typeof value !== 'object') throw new Error('Неверный документ доски');
  const doc = value as BoardDocument;
  if (doc.version !== 1 || !Array.isArray(doc.elements) || doc.elements.length > 10000 || Object.keys(doc).some(key => !['version', 'elements', 'background'].includes(key))) throw new Error('Неверный формат доски');
  if (doc.background && (!['plain', 'dots', 'grid'].includes(doc.background.pattern) || !Number.isInteger(doc.background.size) || !number(doc.background.size, 12, 96) || Object.keys(doc.background).some(key => !['pattern', 'size'].includes(key)))) throw new Error('Неверный фон доски');
  const ids = new Set<string>();
  for (const item of doc.elements) {
    if (!item || !uuid.test(item.id) || ids.has(item.id)) throw new Error('Повторяющийся или неверный объект');
    ids.add(item.id);
    if (item.kind === 'image') {
      if (!uuid.test(item.assetId) || !number(item.x, -1000000, 1000000) || !number(item.y, -1000000, 1000000) ||
          !number(item.width, 1, 10000) || !number(item.height, 1, 10000) ||
          Object.keys(item).some(key => !['id', 'kind', 'assetId', 'x', 'y', 'width', 'height'].includes(key))) throw new Error('Неверное изображение');
    } else {
      if (!['stroke', 'rectangle', 'ellipse', 'triangle', 'line', 'arrow', 'trapezoid', 'parallelepiped'].includes(item.kind) ||
          !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(item.color) || !number(item.width, 1, 64) ||
          (item.opacity !== undefined && !number(item.opacity, .05, 1)) || (item.groupId !== undefined && !uuid.test(item.groupId)) ||
          !Array.isArray(item.points) || item.points.length < 4 || item.points.length > 40000 || item.points.length % 2 ||
          (item.kind !== 'stroke' && item.points.length !== 4) || item.points.some(point => !number(point, -1000000, 1000000)) ||
          Object.keys(item).some(key => !['id', 'groupId', 'kind', 'color', 'width', 'opacity', 'points'].includes(key))) throw new Error('Неверный рисунок');
    }
  }
  if (JSON.stringify(doc).length > 9_000_000) throw new Error('Слишком большая доска');
}
export async function exportLocalProject(board: Board) {
  const all = await localAssets();
  const ids = new Set(board.document.elements.flatMap(element => element.kind === 'image' ? [element.assetId] : []));
  const assets = [];
  for (const id of ids) {
    const asset = all.find(item => item.id === id);
    if (!asset) throw new Error('Не удалось сохранить файл: одно из изображений отсутствует');
    assets.push({ id, mime: asset.blob.type, data: await imageBase64(asset.blob) });
  }
  const blob = new Blob([JSON.stringify({ format: 'BluviBoard', version: 1, title: board.title, document: board.document, assets })], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.download = `${board.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'Доска'}.bluviboard`;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function importLocalProject(file: File) {
  if (file.size > 200 * 1024 * 1024) throw new Error('Файл доски должен быть меньше 200 МБ');
  const project = JSON.parse(await file.text());
  if (project?.format !== 'BluviBoard' || project.version !== 1 || typeof project.title !== 'string' || !Array.isArray(project.assets) || project.assets.length > 1000) throw new Error('Это не файл доски BluviBoard');
  validateLocalDocument(project.document);
  const profile = localProfile(), mapping = new Map<string, string>();
  const images: LocalAsset[] = [];
  const wanted = new Set(project.document.elements.flatMap((element: DrawingElement) => element.kind === 'image' ? [element.assetId] : []));
  for (const asset of project.assets) {
    if (!uuid.test(asset?.id) || typeof asset.data !== 'string' || typeof asset.mime !== 'string' || mapping.has(asset.id)) throw new Error('Неверные изображения в файле доски');
    if (!wanted.has(asset.id)) continue;
    const blob = imageBlob(asset.data, asset.mime);
    if (blob.size > 10 * 1024 * 1024) throw new Error('Изображение в файле превышает 10 МБ');
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    if (!width || !height || width * height > 40_000_000) throw new Error('Слишком большое изображение');
    const id = crypto.randomUUID();
    images.push({ key: recordKey(profile, id), profile, id, blob, width, height });
    mapping.set(asset.id, id);
  }
  if ([...wanted].some(id => !mapping.has(String(id)))) throw new Error('В файле отсутствует изображение. Доска не импортирована.');
  const document: BoardDocument = { ...project.document, elements: project.document.elements.map((element: DrawingElement) => element.kind === 'image' ? { ...element, assetId: mapping.get(element.assetId)! } : element) };
  if (localProfile() !== profile) throw new Error('Аккаунт изменился. Повторите импорт.');
  const board = await createLocalBoard(project.title, document, images);
  localChanged();
  return board;
}
