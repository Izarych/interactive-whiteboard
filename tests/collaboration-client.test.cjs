const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const source = ts.transpileModule(readFileSync('apps/web/src/collaboration.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const element = () => ({ id: randomUUID(), kind: 'stroke', color: '#355dff', width: 4, points: [10, 10, 20, 20] });
const board = () => ({ id: randomUUID(), title: 'Урок', revision: 0, updatedAt: '2026-10-29T00:00:00Z', collaborative: true, document: { version: 1, elements: [] } });
function setup() {
  const sockets = [], timers = new Map();
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    sent = [];
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const storage = new Map();
  const context = { exports: {}, require, WebSocket: Socket, crypto: { randomUUID }, navigator: { onLine: true },
    location: { protocol: 'https:', host: 'example.test' }, performance: { now: () => 1000 },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { addEventListener() {}, removeEventListener() {}, setTimeout(fn) { const key = randomUUID(); timers.set(key, fn); return key; }, setInterval() {}, clearTimeout: key => timers.delete(key), clearInterval() {} },
    clearTimeout: key => timers.delete(key), clearInterval() {},
  };
  vm.runInNewContext(source, context);
  const initial = board(), client = new context.exports.Collaboration(undefined, initial);
  client.start(); const socket = sockets[0]; socket.onopen(); socket.receive({ type: 'ready', board: initial });
  const patch = (revision, value, operationId = randomUUID()) => ({ type: 'patch', boardId: initial.id, baseRevision: revision - 1, revision,
    updatedAt: initial.updatedAt, operationId, operation: { elements: [{ id: value.id, before: null, after: value }] } });
  return { client, socket, initial, patch, timers };
}
test('out-of-order acknowledgements never remove an optimistic stroke before its committed patch is applicable', () => {
  const { client, socket, initial, patch } = setup(); const mine = element(), other = element();
  client.edit({ document: { version: 1, elements: [mine] } });
  const operationId = socket.sent.find(m => m.type === 'operation').operationId;
  socket.receive({ ...patch(2, mine, operationId), type: 'ack' });
  assert(client.state.board.document.elements.some(e => e.id === mine.id));
  assert.equal(client.state.status, 'saving');
  socket.receive(patch(1, other));
  assert.equal(client.state.board.revision, 2);
  assert.equal(client.state.board.document.elements.length, 2);
  assert.equal(client.state.status, 'saved');
  socket.receive({ type: 'board', board: initial });
  assert.equal(client.state.board.document.elements.length, 2);
});
test('completed previews survive a new stroke and cancellation, and disappear only when the saved objects arrive', () => {
  const { client, socket, patch } = setup(); const first = element(), second = element(), cancelled = element();
  for (const value of [first, second]) socket.receive({ type: 'preview', peerId: 'pupil', element: value, finished: true });
  socket.receive({ type: 'preview', peerId: 'pupil', element: cancelled });
  socket.receive({ type: 'preview', peerId: 'pupil', element: null });
  assert.equal(client.state.previews.length, 2);
  socket.receive(patch(1, first)); assert.equal(client.state.previews.length, 1);
  socket.receive(patch(2, second)); assert.equal(client.state.previews.length, 0);
  socket.receive({ type: 'preview', peerId: 'pupil', element: first, finished: true });
  assert.equal(client.state.previews.length, 0);
});
test('a gap requests one fresh snapshot and safely replays unsent local edits', () => {
  const { client, socket, patch, timers, initial } = setup(); const mine = element(), first = element(), second = element();
  client.edit({ document: { version: 1, elements: [mine] } });
  socket.receive(patch(2, second));
  for (const fn of [...timers.values()]) fn();
  assert.equal(socket.sent.filter(m => m.type === 'sync').length, 1);
  socket.receive({ type: 'snapshot', board: { ...initial, revision: 2, document: { version: 1, elements: [first, second] } } });
  assert.equal(client.state.board.document.elements.length, 3);
  assert.equal(socket.sent.filter(m => m.type === 'operation').length, 2);
});
test('protocol negotiation keeps full-snapshot compatibility and final previews bypass throttling', () => {
  const { client, socket, initial } = setup(); assert.equal(socket.sent[0].protocol, 2);
  const value = element(); client.preview(value); client.preview(value); client.preview(value, true);
  assert.equal(socket.sent.filter(m => m.type === 'preview').length, 2);
  assert.equal(socket.sent.at(-1).finished, true);
  socket.receive({ type: 'board', board: { ...initial, revision: 1, document: { version: 1, elements: [value] } } });
  assert.equal(client.state.board.document.elements.length, 1);
});
