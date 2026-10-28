import type { Board, BoardOperation, DrawnElement } from '@whiteboard/shared';
import { applyOperation, difference } from '@whiteboard/shared/board-operations';

export function boardUnavailable() { window.location.replace('/?board-unavailable=1'); }
type Pending = { id: string; operation: BoardOperation };
export class Collaboration {
  private socket?: WebSocket;
  private retry?: number;
  private expiry?: number;
  private stopped = true;
  private sent: string | null = null;
  private listeners = new Set<() => void>();
  private remote: Board | null;
  private pending: Pending[] = [];
  private previewAt = 0;
  private peers = new Map<string, { element: DrawnElement; time: number }>();
  private key: string;
  private failures = 0;
  private lastReceived = Date.now();
  state: { board: Board | null; status: 'saved' | 'pending' | 'saving' | 'local' | 'error'; error: string; draftWarning: string; connected: boolean; previews: DrawnElement[] };
  constructor(readonly token?: string, initial?: Board) {
    this.remote = initial ?? null;
    this.key = token ? `whiteboard:shared-draft:${token}` : `whiteboard:collaborative-draft:${initial!.id}`;
    let warning = '';
    try {
      const draft = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (draft?.version === 1 && draft.remote?.id && typeof draft.remote.title === 'string' && draft.remote.document?.version === 1 &&
        Array.isArray(draft.remote.document.elements) && (!initial || draft.remote.id === initial.id) && Array.isArray(draft.pending)) {
        // A corrupt local queue must not prevent opening the server document.
        const projected = draft.pending.reduce((board: Board, p: Pending) => applyOperation(board, p.operation), draft.remote);
        if (!projected.document.elements.every((e: DrawnElement) => e && typeof e.id === 'string' && typeof e.kind === 'string')) throw new Error('Invalid draft');
        this.remote = draft.remote; this.pending = draft.pending;
      }
    } catch { warning = 'Не удалось прочитать локальную резервную копию.'; }
    this.state = { board: this.project(), status: this.pending.length ? 'local' : 'saved', error: '', draftWarning: warning, connected: false, previews: [] };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private project() { return this.remote ? this.pending.reduce((board, p) => applyOperation(board, p.operation), this.remote) : null; }
  private publish(patch: Partial<typeof this.state> = {}, rebase = false) {
    this.state = { ...this.state, ...(rebase ? { board: this.project() } : {}), ...patch };
    for (const listener of this.listeners) listener();
  }
  private draft() {
    try {
      if (this.pending.length) localStorage.setItem(this.key, JSON.stringify({ version: 1, remote: this.remote, pending: this.pending }));
      else localStorage.removeItem(this.key);
      this.publish({ draftWarning: '', ...(this.state.status === 'error' && !this.state.error ? { status: this.pending.length ? this.state.connected ? 'saving' : 'local' : 'saved' } : {}) });
    } catch {
      if (this.pending.length) this.publish({ draftWarning: 'Локальная резервная копия недоступна. Не закрывайте доску до сохранения на сервер.', ...(this.state.status === 'local' ? { status: 'error' } : {}) });
    }
  }
  start = () => {
    this.stopped = false;
    this.open();
    this.expiry = window.setInterval(() => {
      if (this.socket && Date.now() - this.lastReceived > 45000) this.socket.close();
      for (const [id, peer] of this.peers) if (Date.now() - peer.time > 3500) this.peers.delete(id);
      this.publish({ previews: [...this.peers.values()].map(p => p.element) });
    }, 1500);
    window.addEventListener('online', this.reconnect);
    window.addEventListener('offline', this.disconnect);
    window.addEventListener('beforeunload', this.unload);
    return () => {
      this.stopped = true; clearTimeout(this.retry); clearInterval(this.expiry);
      this.socket?.close(); this.socket = undefined;
      window.removeEventListener('online', this.reconnect);
      window.removeEventListener('offline', this.disconnect);
      window.removeEventListener('beforeunload', this.unload);
    };
  };
  private unload = (event: BeforeUnloadEvent) => { if (this.pending.length) { event.preventDefault(); event.returnValue = ''; } };
  private disconnect = () => {
    clearTimeout(this.retry);
    const socket = this.socket; this.socket = undefined; socket?.close(); this.sent = null;
    this.publish({ connected: false, status: this.pending.length ? this.state.draftWarning ? 'error' : 'local' : 'saved' });
  };
  private reconnect = () => { if (!this.state.connected) { clearTimeout(this.retry); this.socket?.close(); this.open(); } };
  private open() {
    if (this.stopped || !navigator.onLine) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/collaboration/socket`);
    this.socket = socket;
    this.lastReceived = Date.now();
    socket.onopen = () => { if (this.socket === socket) socket.send(JSON.stringify({ type: 'join', ...(this.token ? { token: this.token } : { boardId: this.remote!.id }) })); };
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      this.lastReceived = Date.now();
      const message = JSON.parse(event.data);
      if (message.type === 'unavailable') { this.stopped = true; socket.close(); if (this.token) boardUnavailable(); else this.publish({ error: 'Доска недоступна. Откройте список досок заново.', status: 'error' }); return; }
      if (message.type === 'error') { this.publish({ error: message.message, status: 'error' }); return; }
      if (message.type === 'ready') { this.sent = null; this.failures = 0; this.publish({ connected: true, error: '' }); }
      if (message.board) {
        if (!this.remote || message.board.revision >= this.remote.revision) this.remote = message.board;
        if (message.operationId) {
          this.pending = this.pending.filter(p => p.id !== message.operationId);
          if (this.sent === message.operationId) this.sent = null;
        }
        this.publish({ status: this.pending.length ? 'saving' : 'saved' }, true); this.draft(); this.pump();
      }
      if (message.type === 'preview') {
        if (message.element) this.peers.set(message.peerId, { element: message.element, time: Date.now() }); else this.peers.delete(message.peerId);
        this.publish({ previews: [...this.peers.values()].map(p => p.element) });
      }
    };
    socket.onclose = event => {
      if (this.socket !== socket || this.stopped) return;
      this.sent = null;
      this.publish({ connected: false, status: this.pending.length ? this.state.draftWarning ? 'error' : 'local' : 'saved' });
      if (event.code === 4404 && this.token) { boardUnavailable(); return; }
      this.retry = window.setTimeout(() => this.open(), Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)));
    };
  }
  private pump() {
    if (this.sent || !this.state.connected || this.socket?.readyState !== WebSocket.OPEN || !this.pending.length || this.state.error) return;
    const next = this.pending[0]; this.sent = next.id;
    this.socket.send(JSON.stringify({ type: 'operation', operationId: next.id, operation: next.operation }));
  }
  edit = (patch: Partial<Pick<Board, 'title' | 'document'>>) => {
    const before = this.state.board;
    if (!before || this.stopped) return;
    const after = { ...before, ...patch, title: (patch.title ?? before.title).trim() || 'Без названия' };
    const operation = difference(before, after);
    if (!operation.elements.length && !operation.title && !operation.background) return;
    this.pending.push({ id: crypto.randomUUID(), operation });
    this.publish({ status: this.state.connected ? 'saving' : 'local' }, true); this.draft(); this.pump();
  };
  preview = (element: DrawnElement | null) => {
    if (!this.state.connected || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 1_000_000) return;
    if (element && performance.now() - this.previewAt < 80) return;
    this.previewAt = performance.now();
    this.socket.send(JSON.stringify({ type: 'preview', element }));
  };
  flush = async () => {
    if (!this.pending.length) return;
    this.pump();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { unsubscribe(); reject(new Error(this.state.draftWarning ?
        'Изменения пока не отправлены, а локальная резервная копия недоступна. Не закрывайте доску.' :
        'Изменения пока не отправлены. Они сохранены на устройстве и синхронизируются после подключения.')); }, 8000);
      const unsubscribe = this.subscribe(() => {
        if (!this.pending.length || this.state.error) { clearTimeout(timeout); unsubscribe(); if (this.state.error) reject(new Error(this.state.error)); else resolve(); }
      });
    });
  };
}
