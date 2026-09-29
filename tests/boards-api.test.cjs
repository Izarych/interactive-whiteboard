const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { stat, rm } = require('node:fs/promises');
const { cleanupAssets } = require('./asset-test-utils.cjs');
const imageDirectory = path.resolve(__dirname, `../.test-data/api-assets-${randomUUID()}`);

const port = 3101;
const base = `http://localhost:${port}/api`;
let server;
let output = '';

async function start() {
  output = '';
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: path.resolve(__dirname, '../apps/server'),
    env: { ...process.env, PORT: String(port), STORAGE_PROVIDER: 'local', STORAGE_LOCAL_PATH: imageDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { output += data; });
  server.stderr.on('data', (data) => { output += data; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`API exited: ${output}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && output.includes('API listening')) return;
    } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not start: ${output}`);
}

async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}

async function request(method, route, body, status) {
  const response = await fetch(`${base}${route}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

test('PostgreSQL boards: CRUD, validation, conflicts and persistence after restart', async (t) => {
  const created = [];
  const assets = [];
  try {
    await start();
    let board;
    let other;
    let asset;
    const document = {
      version: 1,
      elements: [
        { id: randomUUID(), kind: 'stroke', color: '#ef4444', width: 4, points: [10, 20, 30, 40, 50, 80] },
        { id: randomUUID(), kind: 'rectangle', color: '#3b82f6', width: 8, points: [-10, 0, 100, 200] },
        { id: randomUUID(), kind: 'ellipse', color: '#22c55e', width: 2, points: [100, 20, 200, 80] },
      ],
    };

    await t.test('create two independent boards and list them', async () => {
      board = await request('POST', '/boards', { title: '  API test  ' }, 201);
      created.push(board.id);
      other = await request('POST', '/boards', { title: 'API test second board' }, 201);
      created.push(other.id);
      assert.equal(board.title, 'API test');
      assert.deepEqual(board.document, { version: 1, elements: [] });
      const list = await request('GET', '/boards', undefined, 200);
      assert.ok(list.some((item) => item.id === board.id));
      assert.ok(list.some((item) => item.id === other.id));
      assert.ok(list.every((item) => !('document' in item)));
    });

    await t.test('save structured drawing and rename without modifying the other board', async () => {
      board = await request('PUT', `/boards/${board.id}`, { title: 'Saved API test', document, revision: 0 }, 200);
      assert.equal(board.revision, 1);
      assert.deepEqual(board.document, document);
      const untouched = await request('GET', `/boards/${other.id}`, undefined, 200);
      assert.deepEqual(untouched.document.elements, []);
    });

    await t.test('reject stale writes, malformed documents and invalid IDs', async () => {
      await request('PUT', `/boards/${board.id}`, { title: 'Stale', document, revision: 0 }, 409);
      await request('PUT', `/boards/${board.id}`, { title: 'Missing', revision: 1 }, 400);
      await request('PUT', `/boards/${board.id}`, { title: 'Null', document: null, revision: 1 }, 400);
      const invalid = structuredClone(document);
      invalid.elements[1].points = [1, 2, 3, 4, 5, 6];
      await request('PUT', `/boards/${board.id}`, { title: 'Invalid shape', document: invalid, revision: 1 }, 400);
      invalid.elements[1].points = [1, 2, 3, 4];
      invalid.elements[0].color = 'not-a-color';
      await request('PUT', `/boards/${board.id}`, { title: 'Invalid color', document: invalid, revision: 1 }, 400);
      await request('POST', '/boards', { title: '   ' }, 400);
      await request('GET', '/boards/invalid-id', undefined, 400);
      const unchanged = await request('GET', `/boards/${board.id}`, undefined, 200);
      assert.equal(unchanged.title, 'Saved API test');
      assert.equal(unchanged.revision, 1);
    });

    await t.test('upload a screenshot, serve PNG bytes and save a referenced image object', async () => {
      const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#22c55e' } }).png().toBuffer();
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), '../../screenshot.png');
      const upload = await fetch(`${base}/assets`, { method: 'POST', body: form });
      assert.equal(upload.status, 201, await upload.clone().text());
      asset = await upload.json();
      assets.push(asset.id);
      assert.equal(asset.width, 320);
      assert.equal(asset.height, 180);
      assert.equal(asset.url, `/api/assets/${asset.id}`);
      assert.ok((await stat(path.join(imageDirectory, `${asset.id}.png`))).size > 0);
      const download = await fetch(`http://localhost:${port}${asset.url}`);
      assert.equal(download.headers.get('content-type'), 'image/png');
      assert.ok(download.headers.get('cache-control').includes('immutable'));
      const metadata = await sharp(Buffer.from(await download.arrayBuffer())).metadata();
      assert.equal(metadata.width, 320);
      document.elements.push({ id: randomUUID(), kind: 'image', assetId: asset.id, x: 10, y: 30, width: 320, height: 180 });
      board = await request('PUT', `/boards/${board.id}`, { title: board.title, document, revision: board.revision }, 200);
      assert.deepEqual(board.document, document);
      await request('PUT', `/boards/${other.id}`, { title: other.title, document, revision: 0 }, 200);
    });

    await t.test('reject corrupt, unsupported and oversized uploads, invalid image objects and missing assets', async () => {
      for (const content of ['not an image', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>']) {
        const form = new FormData();
        form.append('file', new Blob([content], { type: 'image/png' }), 'invalid.png');
        assert.equal((await fetch(`${base}/assets`, { method: 'POST', body: form })).status, 400);
      }
      assert.equal((await fetch(`${base}/assets`, { method: 'POST', body: new FormData() })).status, 400);
      const large = new FormData();
      large.append('file', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
      assert.equal((await fetch(`${base}/assets`, { method: 'POST', body: large })).status, 413);
      const invalid = structuredClone(document);
      invalid.elements.at(-1).height = 0;
      await request('PUT', `/boards/${board.id}`, { title: board.title, document: invalid, revision: board.revision }, 400);
      invalid.elements.at(-1).height = 180;
      invalid.elements.at(-1).assetId = randomUUID();
      await request('PUT', `/boards/${board.id}`, { title: board.title, document: invalid, revision: board.revision }, 400);
      const missing = await fetch(`${base}/assets/${randomUUID()}`);
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get('cache-control'), null);
    });

    await t.test('drawing survives API restart in PostgreSQL', async () => {
      await stop();
      await start();
      const persisted = await request('GET', `/boards/${board.id}`, undefined, 200);
      assert.equal(persisted.title, 'Saved API test');
      assert.deepEqual(persisted.document, document);
      assert.equal((await fetch(`http://localhost:${port}${asset.url}`)).status, 200);
    });

    await t.test('clear drawing and delete only the selected board', async () => {
      await request('PUT', `/boards/${board.id}`, { title: board.title, document: { version: 1, elements: [] }, revision: board.revision }, 200);
      await request('DELETE', `/boards/${board.id}`, undefined, 204);
      await request('GET', `/boards/${board.id}`, undefined, 404);
      await request('GET', `/boards/${other.id}`, undefined, 200);
      assert.equal((await fetch(`http://localhost:${port}${asset.url}`)).status, 200, 'Copied board keeps the image');
    });
  } finally {
    for (const id of created) {
      await fetch(`${base}/boards/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    await stop();
    await cleanupAssets(assets, imageDirectory);
    await rm(imageDirectory, { recursive: true, force: true });
  }
});

test('Yandex-compatible S3 adapter signs uploads, reads private images and deletes rolled-back objects', async () => {
  const { createServer } = require('node:http');
  const { ConfigService } = require('@nestjs/config');
  const { StorageService } = require('../apps/server/dist/storage.service');
  const objects = new Map();
  const headers = [];
  const mock = createServer(async (request, response) => {
    headers.push(request.headers);
    const key = request.url.split('?')[0];
    if (request.method === 'PUT') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"test-etag"' }).end();
    } else if (request.method === 'GET') {
      const data = objects.get(key);
      if (!data) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length }).end(data);
    } else if (request.method === 'DELETE') {
      objects.delete(key);
      response.writeHead(204).end();
    } else response.writeHead(405).end();
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const storage = new StorageService(new ConfigService({
    STORAGE_PROVIDER: 's3', S3_ENDPOINT: `http://127.0.0.1:${mock.address().port}`,
    S3_BUCKET: 'test-bucket', S3_REGION: 'ru-central1', S3_ACCESS_KEY_ID: 'test-access', S3_SECRET_ACCESS_KEY: 'test-secret',
  }));
  try {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#3b82f6' } }).png().toBuffer();
    const stored = await storage.write(`${randomUUID()}.png`, bytes);
    assert.equal(stored.provider, 's3');
    assert.equal(stored.bucket, 'test-bucket');
    const chunks = [];
    for await (const chunk of await storage.read(stored)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.match(headers[0].authorization, /Credential=test-access\/.*\/ru-central1\/s3\/aws4_request/);
    assert.equal(headers[0]['x-amz-acl'], undefined);
    assert.equal(headers[0]['x-amz-sdk-checksum-algorithm'], undefined);
    await storage.remove(stored);
    assert.equal(objects.size, 0);
  } finally {
    storage.onModuleDestroy();
    await new Promise((resolve) => mock.close(resolve));
  }
});
