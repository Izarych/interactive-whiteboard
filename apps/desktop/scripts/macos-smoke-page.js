// Runs inside the real bundled WKWebView, only with explicit native CI flags.
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (condition, message) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) { const value = condition(); if (value) return value; await sleep(50); }
    throw new Error(`Timed out: ${message}`);
  };
  const button = label => [...document.querySelectorAll('button')].find(node => !node.disabled && (node.getAttribute('aria-label') === label || node.textContent.trim() === label));
  const text = value => document.body.innerText.includes(value);
  const fill = (node, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const files = (node, file) => {
    const data = new DataTransfer(); data.items.add(file); node.files = data.files;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const draw = async (finish = true) => {
    const canvas = document.querySelector('[data-testid="canvas"] canvas'), box = canvas.getBoundingClientRect();
    const dispatch = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: box.x + x, clientY: box.y + y }));
    dispatch('pointerdown', 120, 210, 1);
    for (let step = 1; step <= 12; step++) dispatch('pointermove', 120 + step * 15, 210 + step * 5, 1);
    if (finish) dispatch('pointerup', 300, 270, 0);
    await sleep(50);
  };
  const key = target => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'CapsLock', code: 'CapsLock' }));
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'CapsLock', code: 'CapsLock' }));
  };
  const run = async () => {
    await wait(() => window.__TAURI_INTERNALS__ && button('+ Новая доска'), 'offline workspace');
    assert(window.__BLUVIBOARD_OFFLINE__ === true, 'Bundled offline marker is missing');
    assert(window.__BLUVIBOARD_DESKTOP_OS__ === 'macos', 'Not a macOS build');
    assert(window.__BLUVIBOARD_DESKTOP_VERSION__ === window.__BLUVIBOARD_SMOKE_VERSION__, 'Wrong installed version');
    assert(window.__BLUVIBOARD_PREVIEW__ === window.__BLUVIBOARD_SMOKE_PREVIEW__, 'Wrong installed application identity');
    assert(location.protocol === 'tauri:' && location.hostname === 'localhost', `Unexpected origin: ${location.href}`);
    // Synthetic input is used instead of a WebDriver, which WKWebView does not
    // provide. Only pointer capture is shimmed; the real canvas/editor handles it.
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    const exports = [], network = [], errors = [];
    window.addEventListener('error', event => errors.push(event.message));
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = (url, ...options) => {
      if (/^https?:/i.test(String(url?.url ?? url))) {
        network.push(String(url)); return Promise.reject(new Error('Native smoke: internet is unavailable'));
      }
      return fetchOriginal(url, ...options);
    };
    const invokeOriginal = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    window.__TAURI_INTERNALS__.invoke = async (command, args, ...rest) => {
      if (command === 'desktop_cloud_request' || command === 'desktop_cloud_upload') network.push(command);
      const result = await invokeOriginal(command, args, ...rest);
      if (command === 'desktop_save_file') exports.push(args.name);
      return result;
    };
    const report = result => invokeOriginal('desktop_diagnostic', { action: 'report', result: { phase: window.__BLUVIBOARD_SMOKE_PHASE__, ...result, errors, network } });
    const close = () => invokeOriginal('desktop_diagnostic', { action: 'close', result: null });
    const saved = () => wait(() => text('Сохранено на компьютере'), 'strict local disk save');
    const phase = window.__BLUVIBOARD_SMOKE_PHASE__;
    if (phase === 'first') {
      assert(!document.querySelector('[data-testid="canvas"]'), 'Fresh profile contains a board');
      button('+ Новая доска').click();
      await wait(() => document.querySelector('input[aria-label="Название доски"]'), 'new board');
      fill(document.querySelector('input[aria-label="Название доски"]'), 'Native macOS offline');
      await draw();
      const image = document.createElement('canvas'); image.width = 80; image.height = 60;
      const context = image.getContext('2d'); context.fillStyle = '#2563eb'; context.fillRect(0, 0, 80, 60);
      const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png'));
      files(document.querySelector('input[aria-label="Загрузить изображения"]'), new File([blob], 'offline.png', { type: 'image/png' }));
      await wait(() => text('2 объектов'), 'drawing and image');
      await saved();
      button('Действия доски').click();
      (await wait(() => button('Сохранить файл доски'), 'project export menu')).click();
      await wait(() => exports.some(name => name.endsWith('.bluviboard')), 'native project export');
      button('Действия доски').click();
      (await wait(() => button('Скачать PNG'), 'PNG export menu')).click();
      await wait(() => exports.some(name => name.endsWith('.png')), 'native PNG export');
      button('Ластик').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
      const hotkey = await wait(() => document.querySelector('input[aria-label="Хоткей: Ластик"]'), 'hotkey settings');
      hotkey.focus(); key(hotkey);
      (await wait(() => { const node = button('Сохранить хоткей'); return node && !node.disabled && node; }, 'recorded hotkey')).click();
      await wait(() => text('Хоткей сохранён'), 'persisted hotkey');
      button('Карандаш').click();
      await wait(() => button('Карандаш')?.getAttribute('aria-pressed') === 'true', 'pencil before closing stroke');
      await draw(false);
      await report({ status: 'passed', exports, activeStrokeOnClose: true });
      await close();
    } else {
      await wait(() => document.querySelector('input[aria-label="Название доски"]')?.value === 'Native macOS offline', 'board after native restart');
      await wait(() => text(phase === 'restart' ? '3 объектов' : '4 объектов'), 'persisted drawings and image');
      await saved();
      key(document.body);
      await wait(() => button('Ластик')?.getAttribute('aria-pressed') === 'true', 'hotkey after restart');
      key(document.body); button('Карандаш').click();
      await wait(() => button('Карандаш')?.getAttribute('aria-pressed') === 'true', 'pencil after hotkey');
      if (phase === 'restart') {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(names, mode, ...options) {
          if (mode === 'readwrite' && (typeof names === 'string' ? [names] : Array.from(names)).includes('boards')) throw new Error('Native smoke: disk write refused');
          return original.call(this, names, mode, ...options);
        };
        await draw();
        await close();
        await wait(() => text('disk write refused') && button('Повторить'), 'failed native close remains recoverable');
        IDBDatabase.prototype.transaction = original;
        await report({ status: 'passed', refusedUnsafeClose: true });
        button('Повторить').click();
      } else {
        const raw = window.__BLUVIBOARD_SMOKE_IMPORT__;
        assert(typeof raw === 'string', 'Missing exported project');
        files(document.querySelector('input[aria-label="Открыть файл доски"]'), new File([raw], 'native.bluviboard', { type: 'application/json' }));
        await wait(() => text('Импортирована доска'), 'project import');
        const boardButtons = await wait(() => {
          const nodes = [...document.querySelectorAll('nav[aria-label="Доски"] button')].filter(node => node.textContent.startsWith('Native macOS offline'));
          return nodes.length === 2 && nodes;
        }, 'separate imported board');
        boardButtons[0].click();
        await wait(() => text('2 объектов'), 'imported document and image');
        await saved();
        assert(errors.length === 0 && network.length === 0, 'Unexpected JS errors or website requests');
        await report({ status: 'passed', importedProject: true });
        await close();
      }
    }
  };
  const start = () => run().catch(async error => {
    try { await window.__TAURI_INTERNALS__.invoke('desktop_diagnostic', { action: 'failure', result: { status: 'failed', message: error.message, stack: error.stack, body: document.body?.innerText } }); }
    catch (failure) { console.error(failure); }
  });
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
