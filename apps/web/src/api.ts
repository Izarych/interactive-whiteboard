import type { ActiveSession, Board, BoardSummary, DesktopRelease, EmailChallenge, ImageAsset, RegisterAccount, SessionInfo, ToolShortcuts, UpdateBoard, UserProfile } from '@whiteboard/shared';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options?.headers },
      signal: AbortSignal.timeout(options?.body instanceof FormData ? 60000 : 15000),
    });
  } catch {
    throw new ApiError('Не удалось подключиться. Проверьте соединение и попробуйте ещё раз.', 0);
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('whiteboard:session-expired'));
    const data = await response.json().catch(() => ({}));
    const message = Array.isArray(data.message) ? data.message.join('; ') : data.message;
    throw new ApiError(message || 'Не удалось выполнить действие. Попробуйте ещё раз.', response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const api = {
  toolShortcuts: () => request<{ shortcuts: ToolShortcuts }>('/preferences/tools'),
  saveToolShortcuts: (shortcuts: ToolShortcuts) => request<{ shortcuts: ToolShortcuts }>('/preferences/tools', { method: 'PUT', body: JSON.stringify({ shortcuts }) }),
  desktopRelease: () => request<{ release: DesktopRelease | null }>('/desktop/latest').then((result) => result.release),
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
  session: () => request<SessionInfo>('/auth/session'),
  guest: () => request<ActiveSession>('/auth/guest', { method: 'POST' }),
  login: (email: string, password: string) => request<ActiveSession>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  adminLogin: (email: string, password: string) => request<ActiveSession>('/auth/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  register: (body: RegisterAccount) => request<EmailChallenge>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  verifyEmail: (challengeId: string, code: string) => request<ActiveSession>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ challengeId, code }) }),
  resendVerification: (challengeId: string) => request<EmailChallenge>('/auth/register/resend', { method: 'POST', body: JSON.stringify({ challengeId }) }),
  forgotPassword: (email: string) => request<EmailChallenge>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (challengeId: string, code: string, password: string) => request<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ challengeId, code, password }) }),
  updateProfile: (name: string, avatarAssetId?: string | null) => request<UserProfile>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ name, avatarAssetId }) }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImageAsset>('/assets/avatar', { method: 'POST', body: form });
  },
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}
