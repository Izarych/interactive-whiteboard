import type { AdminAsset, AdminAudit, AdminBoard, AdminGuest, AdminOverview, AdminPage, AdminUser, Board, SiteFile, SiteFileName } from '@whiteboard/shared';
import { request } from './api';

const write = (method: string, body?: object): RequestInit => ({ method, body: body ? JSON.stringify(body) : undefined });
const query = (page: number, search: string, status: string) => `?page=${page}&pageSize=20&search=${encodeURIComponent(search)}&status=${status}`;
export const adminApi = {
  siteFiles: () => request<SiteFile[]>('/admin/site-files'),
  saveSiteFile: (name: SiteFileName, content: string, revision: string | null) => request<SiteFile>(`/admin/site-files/${name}`, write('PUT', { content, revision })),
  overview: (days: number) => request<AdminOverview>(`/admin/overview?days=${days}`),
  users: (page: number, search: string, status: string) => request<AdminPage<AdminUser>>(`/admin/users${query(page, search, status)}`),
  guests: (page: number, search: string, status: string) => request<AdminPage<AdminGuest>>(`/admin/guests${query(page, search, status)}`),
  boards: (page: number, search: string) => request<AdminPage<AdminBoard>>(`/admin/boards${query(page, search, 'all')}`),
  images: (page: number, search: string) => request<AdminPage<AdminAsset>>(`/admin/images${query(page, search, 'all')}`),
  audit: (page: number, search: string) => request<AdminPage<AdminAudit>>(`/admin/audit${query(page, search, 'all')}`),
  board: (id: string) => request<Board & AdminBoard>(`/admin/boards/${id}`),
  createUser: (name: string, email: string, password: string) => request<{ id: string }>('/admin/users', write('POST', { name, email, password })),
  updateUser: (id: string, name: string, removeAvatar: boolean) => request<void>(`/admin/users/${id}`, write('PATCH', { name, ...(removeAvatar ? { avatarAssetId: null } : {}) })),
  avatar: (id: string, file: File) => {
    const form = new FormData(); form.append('file', file);
    return request(`/admin/users/${id}/avatar`, { method: 'POST', body: form });
  },
  password: (id: string, password: string) => request<void>(`/admin/users/${id}/password`, write('POST', { password })),
  role: (id: string, role: 'user' | 'admin', password: string) => request<void>(`/admin/users/${id}/role`, write('POST', { role, password })),
  block: (kind: 'users' | 'guests', id: string, blocked: boolean) => request<void>(`/admin/${kind}/${id}/block`, write('POST', { blocked })),
  revoke: (id: string) => request<void>(`/admin/users/${id}/revoke-sessions`, write('POST')),
  deleteOwner: (kind: 'users' | 'guests', id: string) => request<void>(`/admin/${kind}/${id}`, write('DELETE')),
  transferGuest: (id: string, email: string) => request<void>(`/admin/guests/${id}/transfer`, write('POST', { email })),
  renameBoard: (id: string, title: string) => request<void>(`/admin/boards/${id}`, write('PATCH', { title })),
  clearBoard: (id: string) => request<void>(`/admin/boards/${id}/clear`, write('POST')),
  deleteBoard: (id: string) => request<void>(`/admin/boards/${id}`, write('DELETE')),
  deleteImage: (id: string) => request<void>(`/admin/images/${id}`, write('DELETE')),
  previewMail: (email: string) => request<void>('/admin/mail/preview', write('POST', { email })),
};
