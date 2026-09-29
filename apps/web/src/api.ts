import type { Board, BoardSummary, ImageAsset, UpdateBoard } from '@whiteboard/shared';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options?.headers },
      signal: AbortSignal.timeout(options?.body instanceof FormData ? 60000 : 15000),
    });
  } catch {
    throw new ApiError('Не удалось подключиться. Проверьте соединение и попробуйте ещё раз.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = Array.isArray(data.message) ? data.message.join('; ') : data.message;
    throw new ApiError(message || 'Не удалось выполнить действие. Попробуйте ещё раз.', response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const api = {
  list: () => request<BoardSummary[]>('/boards'),
  create: (title: string) => request<Board>('/boards', { method: 'POST', body: JSON.stringify({ title }) }),
  get: (id: string) => request<Board>(`/boards/${id}`),
  save: (id: string, body: UpdateBoard) => request<Board>(`/boards/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id: string) => request<void>(`/boards/${id}`, { method: 'DELETE' }),
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImageAsset>('/assets', { method: 'POST', body: form });
  },
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}
