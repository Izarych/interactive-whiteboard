import { Injectable, OnModuleDestroy, HttpException } from '@nestjs/common';
import type { Server, IncomingMessage } from 'node:http';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { Board, BoardOperation } from '@whiteboard/shared';
import { CollaborationService } from './collaboration.service';
import type { BoardAccess, CommittedChange } from './collaboration.service';
import { BoardsService } from './boards.service';

type Peer = { socket: WebSocket; request: Request; id: string; access?: BoardAccess; protocol?: number; alive: boolean; count: number; bytes: number; window: number; pending: number };
@Injectable()
export class CollaborationSocket implements OnModuleDestroy {
  private readonly peers = new Set<Peer>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024, perMessageDeflate: false });
  private timer?: NodeJS.Timeout;
  constructor(private readonly collaboration: CollaborationService, private readonly boards: BoardsService) {}
  attach(server: Server) {
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/api/collaboration/socket' || request.headers.origin !== (process.env.WEB_ORIGIN ?? 'http://localhost:5173') || this.peers.size >= 200) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      this.wss.handleUpgrade(request, socket, head, ws => this.connect(ws, request));
    });
    this.boards.events.on('board', (board: Board, operationId: string, change: CommittedChange) => {
      for (const peer of this.peers) if (peer.access?.boardId === board.id) void this.deliver(peer, peer.protocol === 2 ?
        this.patch('patch', board, operationId, change) : { type: 'board', board, operationId });
    });
    this.boards.events.on('sharing', (id: string) => {
      for (const peer of this.peers) if (peer.access?.boardId === id) void this.deliver(peer, { type: 'sharing' });
    });
    this.boards.events.on('revoked', (id: string) => {
      for (const peer of this.peers) if (peer.access?.boardId === id) this.revoke(peer);
    });
    this.timer = setInterval(() => {
      for (const peer of this.peers) {
        if (!peer.alive || !peer.access) { peer.socket.terminate(); continue; }
        peer.alive = false; peer.socket.ping();
        void this.deliver(peer, { type: 'heartbeat' });
      }
    }, 20000);
  }
  private patch(type: string, board: Board, operationId: string, change: CommittedChange) {
    return { type, boardId: board.id, revision: board.revision, updatedAt: board.updatedAt, operationId, ...change };
  }
  private send(peer: Peer, message: unknown) {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    if (peer.socket.bufferedAmount > 12 * 1024 * 1024) { peer.socket.close(1013, 'Slow connection'); return; }
    peer.socket.send(JSON.stringify(message));
  }
  private revoke(peer: Peer) { this.send(peer, { type: 'unavailable' }); peer.socket.close(4404, 'Board unavailable'); }
  private async deliver(peer: Peer, message: unknown) {
    try { if (peer.access) { await this.collaboration.checkAccess(peer.access); this.send(peer, message); } }
    catch (error) { if (error instanceof HttpException && [401, 403, 404].includes(error.getStatus())) this.revoke(peer); }
  }
  private connect(socket: WebSocket, request: IncomingMessage) {
    const peer: Peer = { socket, request: request as Request, id: randomUUID(), alive: true, count: 0, bytes: 0, window: Date.now(), pending: 0 };
    this.peers.add(peer);
    socket.on('error', () => {});
    socket.on('pong', () => { peer.alive = true; });
    socket.on('close', () => {
      this.peers.delete(peer);
      for (const other of this.peers) if (other.access?.boardId === peer.access?.boardId) this.send(other, { type: 'preview', peerId: peer.id, element: null, disconnected: true });
    });
    let queue = Promise.resolve();
    socket.on('message', (bytes, binary) => {
      if (Date.now() - peer.window > 1000) { peer.count = 0; peer.bytes = 0; peer.window = Date.now(); }
      peer.bytes += Buffer.isBuffer(bytes) ? bytes.length : bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.reduce((n, b) => n + b.length, 0);
      if (binary || ++peer.count > 40 || peer.bytes > 24 * 1024 * 1024 || ++peer.pending > 50) { socket.close(4400, 'Message limit'); return; }
      queue = queue.then(async () => {
        try {
          const message = JSON.parse(bytes.toString());
          if (!peer.access) {
            if (message.type !== 'join') throw new Error('Join required');
            peer.protocol = message.protocol === 2 ? 2 : 1;
            if (message.token) {
              const joined = await this.collaboration.join(peer.request, message.token);
              peer.access = joined.access;
              this.send(peer, { type: 'ready', board: joined.board, peerId: peer.id });
            } else {
              peer.access = { request: peer.request, boardId: message.boardId };
              const row = await this.collaboration.authorize(peer.access);
              this.send(peer, { type: 'ready', board: this.collaboration.publicBoard(row), peerId: peer.id });
            }
          } else if (message.type === 'operation') {
            const { board, change } = await this.collaboration.operation(peer.access, message.operationId, message.operation as BoardOperation);
            this.send(peer, peer.protocol === 2 && change ? this.patch('ack', board, message.operationId, change) : { type: 'ack', board, operationId: message.operationId });
          } else if (message.type === 'sync') {
            const row = await this.collaboration.authorize(peer.access);
            this.send(peer, { type: 'snapshot', board: this.collaboration.publicBoard(row) });
          } else if (message.type === 'preview') {
            await this.collaboration.preview(peer.access, message.element);
            for (const other of this.peers) if (other !== peer && other.access?.boardId === peer.access.boardId) await this.deliver(other, { type: 'preview', peerId: peer.id, element: message.element, finished: message.finished === true });
          } else throw new Error('Unknown message');
        } catch (error) {
          if (error instanceof HttpException && [401, 403, 404].includes(error.getStatus())) this.revoke(peer);
          else if (error instanceof HttpException && error.getStatus() < 500) this.send(peer, { type: 'error', message: error.message });
          else socket.close(1011, 'Retry connection');
        } finally { peer.pending--; }
      });
    });
  }
  onModuleDestroy() { clearInterval(this.timer); for (const peer of this.peers) peer.socket.terminate(); this.wss.close(); }
}
