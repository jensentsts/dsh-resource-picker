import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { registerHooks } from 'node:module';
import vm from 'node:vm';
// Optional semantic DOM lane. No server, profile, browser token or real external delivery.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = process.env.DSH_SOURCE_ROOT;
let React, ReactDom, JSDOM, Zod, Modal;
if (upstream) {
  Zod = await import(pathToFileURL(resolve(upstream, 'node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js')));
  React = (await import(pathToFileURL(resolve(upstream, 'node_modules/.pnpm/react@18.3.1/node_modules/react/index.js')))).default;
  ({ JSDOM } = await import(pathToFileURL(resolve(upstream, 'node_modules/.pnpm/jsdom@29.1.1_@noble+hashes@2.4.0/node_modules/jsdom/lib/api.js'))));
  await import('./runtime-loader.mjs');
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/ui-primitives/src/Modal.module.css')) {
        return { format: 'module', source: 'export default { root: "modal-root", mask: "modal-mask", dialog: "modal-dialog" };', shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
function locale(dict, key, values = {}) { return (dict[key] ?? key).replace(/\{([^}]+)\}/gu, (_match, name) => String(values[name])); }
const h = (...args) => React.createElement(...args);
async function setup({ failAction, nativeAccess = false, settings = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="launch">Launch</button><main id="test-root"></main></body></html>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, HTMLElement: globalThis.HTMLElement, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ReactDom ??= await import(pathToFileURL(resolve(upstream, 'node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/client.js')));
  Modal ??= (await import(pathToFileURL(resolve(upstream, 'packages/client/ui-primitives/src/Modal.tsx')))).Modal;
  const workspaces = { phase: 'ready', items: [{ workspaceId: 'w', title: 'Project', path: '/work', sessionIds: ['s'] }] };
  const sessions = { phase: 'ready', byId: { s: { id: 's', displayTitle: 'Discussion', origin: undefined } } };
  const dictionaries = JSON.parse(await readFile(resolve(root, 'locale/en.json'), 'utf8'));
  let entry, source, apply;
  const disposers = [], calls = [], providers = new Map(), services = new Map();
  const capability = { execute: async request => {
    calls.push(request);
    if (request.action === failAction) return { ok: true, value: { ok: false, error: { code: 'fixture-denied', message: 'Fixture refuses selection' } } };
    let value;
    if (request.action === 'preview') value = { kind: 'text-fallback', items: [{ seq: 1, role: 'user', text: 'Preview text', attachments: [] }], hasMore: false, cursor: 1 };
    if (request.action === 'validate') value = { items: request.items, ...(request.modelSelection ? { modelSelection: request.modelSelection } : {}) };
    if (request.action === 'models') value = { default: { provider: 'p', model: 'm' }, groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }], failures: [] };
    if (request.action === 'create-session') value = { type: 'session', workspaceId: 'w', sessionId: 'new', title: 'new' };
    if (request.action === 'files') value = { entries: [{ name: 'a.txt', type: 'file' }, { name: 'folder', type: 'directory' }], truncated: false };
    if (request.action === 'file-preview') value = { text: 'File content', eof: true, truncated: false };
    return { ok: true, value: { ok: true, value } };
  } };
  const factoryCalls = [];
  let useSessionAccess = () => true;
  if (nativeAccess) {
    const { keyedObservableHook } = await import(pathToFileURL(resolve(upstream, 'packages/client/ui-renderer/src/client/bindings.tsx')));
    const sources = new Map();
    useSessionAccess = keyedObservableHook((id, action) => {
      const key = JSON.stringify([id, action]);
      if (!sources.has(key)) sources.set(key, { getSnapshot: () => id !== '', subscribe: () => () => {} });
      return sources.get(key);
    });
  }
  const resources = { register: provider => { providers.set(provider.protocol, provider); return () => providers.delete(provider.protocol); } };
  function useResource(address) {
    const key = address;
    const [state, setState] = React.useState({ status: address ? 'loading' : 'none' });
    React.useEffect(() => {
      if (!key) { setState({ status: 'none' }); return; }
      const controller = new AbortController();
      setState({ status: 'loading' });
      const provider = providers.get('local-resource-picker');
      (async () => { for await (const item of provider.open(key, { signal: controller.signal })) if (!controller.signal.aborted) setState(item.ok ? { status: 'live', value: item.value } : { status: 'failed', failure: item.error }); })();
      return () => controller.abort();
    }, [key]);
    return state;
  }
  const ctx = {
    remote: { $mount: async contribution => { assert.equal(contribution.descriptors[0].namespace, 'resourcePicker'); } },
    slots: {
      inject: (_name, callback) => { const effects = callback(); if (typeof effects === 'function') disposers.push(effects); else if (effects) for (const disposer of effects) if (typeof disposer === 'function') disposers.push(disposer); },
      snapshot: () => [],
      register: (options, component) => { entry = { options, component }; return () => { entry = undefined; }; },
    },
    locale: { register: () => () => {}, }, resources,
    get: name => name.startsWith('remote.') ? capability : services.get(name),
    provide: (name, value) => { services.set(name, value); },
    effect: callback => { const disposer = callback(); if (typeof disposer === 'function') disposers.push(disposer); return disposer; },
    inject: (_deps, callback) => callback({ ...ctx, 'remote.resourcePicker': capability }),
  };
  vm.runInNewContext(await readFile(resolve(root, 'client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { apply = definition.factory(name => {
      if (name === 'react') return React;
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal };
      assert.equal(name, 'zod');
      return Zod;
    }).apply; } } }, console, AbortController, URL, TextEncoder, setTimeout, clearTimeout,
  });
  await apply(ctx);
  const service = services.get('resourcePicker');
  assert.equal(service.version, 1); assert.equal(service.capabilities().overlay, true);
  assert.equal(service.select, undefined);
  const ReactRoot = ReactDom.createRoot(dom.window.document.getElementById('test-root'));
  const render = async () => {
    source = entry.options.inject();
    const Component = entry.component;
    function BoundOverlay() {
      const request = React.useSyncExternalStore(source.hooks.pickerRequest.subscribe, source.hooks.pickerRequest.getSnapshot);
      return h(Component, { ...source, usePickerRequest: selector => selector(request), useWorkspaces: selector => selector(workspaces), useSessions: selector => selector(sessions), useSessionAccess, useWorkspaceAccess: () => true, useRemoteAccess: () => true, useResource, renderFactorySlot: (name, input, options) => { factoryCalls.push({ name, input }); return options?.fallback ?? null; }, t: (key, values) => locale(dictionaries, key, values) });
    }
    function TestShell() {
      const [settingsOpen, setSettingsOpen] = React.useState(settings);
      return h(React.Fragment, null,
        h(Modal, { open: settingsOpen, headless: true, title: 'Settings', onClose: () => setSettingsOpen(false) },
          h('button', { id: 'settings-launch', type: 'button', onClick: () => void service.open({ allowedTypes: ['session'] }) }, 'Open picker')),
        h(BoundOverlay));
    }
    await React.act(async () => { ReactRoot.render(h(TestShell)); });
  };
  const tick = async () => { await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
  return { dom, calls, factoryCalls, service, render, tick, disposeOverlay() { const cleanup = disposers.splice(0); for (const dispose of cleanup.reverse()) dispose(); }, async close() {
    await React.act(async () => ReactRoot.unmount());
    for (const dispose of disposers.reverse()) dispose();
    dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true });
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
  } };
}
test('native access hooks keep the dialog open when leaving a session preview and reopening', { skip: !upstream }, async () => {
  const ui = await setup({ nativeAccess: true });
  try {
    const pending = ui.service.open({ workspaceId: 'w', sessionId: 's' });
    await ui.render(); await ui.tick();
    const workspace = [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent.includes('Project'));
    await React.act(async () => workspace.click()); await ui.tick();
    assert.ok(ui.dom.window.document.querySelector('[role=dialog]'));
    assert.equal(ui.calls.find(call => call.action === 'files').sessionId, undefined);
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
    assert.equal((await pending).status, 'cancelled');
    let reopened;
    await React.act(async () => { reopened = ui.service.open({ workspaceId: 'w' }); });
    assert.ok(ui.dom.window.document.querySelector('[role=dialog]'));
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
    assert.equal((await reopened).status, 'cancelled');
    assert.equal(ui.calls.some(call => call.action === 'create-session'), false);
  } finally { await ui.close(); }
});

test('compiled UI selects a session with explicit consent and passive preview only', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const promise = ui.service.open({ allowedTypes: ['session'], workspaceId: 'w', sessionId: 's' });
    await ui.render(); await ui.tick();
    assert.match(ui.dom.window.document.body.textContent, /Preview text/);
    assert.match(ui.dom.window.document.body.textContent, /Conversation text preview/);
    assert.deepEqual(ui.calls.map(call => call.action), ['preview']);
    const session = [...ui.dom.window.document.querySelectorAll('.dsrp-row-main')].find(button => button.textContent.includes('Discussion'));
    await React.act(async () => session.click());
    const choose = [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Choose');
    assert.equal(choose.disabled, false);
    await React.act(async () => choose.click()); await ui.tick();
    assert.equal((await promise).status, 'selected');
    assert.deepEqual(ui.calls.map(call => call.action), ['preview', 'validate']);
    assert.equal(ui.dom.window.document.querySelector('[role=dialog]'), null);
  } finally { await ui.close(); }
});

test('picker sits above Settings and dismisses independently by mask or Escape', { skip: !upstream }, async () => {
  const ui = await setup({ settings: true });
  try {
    await ui.render();
    const { document, KeyboardEvent } = ui.dom.window;
    const launcher = document.getElementById('settings-launch');
    const settingsDialog = launcher.closest('[role=dialog]');
    const open = async () => {
      await React.act(async () => launcher.click());
      const dialog = document.querySelector('.dsrp-dialog');
      assert.equal(dialog.parentElement.parentElement, document.body);
      assert.deepEqual([...document.querySelectorAll('[role=dialog]')], [settingsDialog, dialog]);
      assert.equal(document.activeElement, dialog.querySelector('[data-modal-autofocus]'));
      return dialog;
    };
    const first = await open();
    await React.act(async () => first.parentElement.querySelector('.modal-mask').click());
    assert.deepEqual([...document.querySelectorAll('[role=dialog]')], [settingsDialog]);
    assert.equal(document.activeElement, launcher);
    await open();
    await React.act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.deepEqual([...document.querySelectorAll('[role=dialog]')], [settingsDialog]);
    assert.equal(document.activeElement, launcher);
  } finally { await ui.close(); }
});
test('compiled UI returns model and effort as data without applying it', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const promise = ui.service.open({ allowedTypes: ['session'], workspaceId: 'w', sessionId: 's', selectModel: true });
    await ui.render(); await ui.tick();
    await React.act(async () => ui.dom.window.document.querySelector('input[type=checkbox]').click());
    const effort = [...ui.dom.window.document.querySelectorAll('select')][1];
    await React.act(async () => { effort.value = 'high'; effort.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })); });
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Choose').click());
    const result = await promise;
    assert.deepEqual(JSON.parse(JSON.stringify(result.modelSelection)), { provider: 'p', model: 'm', reasoningEffort: 'high' });
    assert.equal(ui.calls.some(call => call.action === 'selectModel'), false);
  } finally { await ui.close(); }
});
test('compiled UI explicit new session remains after user cancellation', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const promise = ui.service.open({ allowedTypes: ['session'], workspaceId: 'w', allowCreateSession: true });
    await ui.render();
    await React.act(async () => { const create = [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'New session'); create.click(); create.click(); });
    assert.match(ui.dom.window.document.querySelector('.dsrp-dialog [role=status]').textContent, /Session created/);
    assert.equal(ui.dom.window.document.querySelector('.dsrp-primary').disabled, false);
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
    assert.equal((await promise).status, 'cancelled');
    assert.equal(ui.calls.filter(call => call.action === 'create-session').length, 1);
    assert.equal(ui.calls.some(call => call.action === 'delete' || call.action === 'validate'), false);
  } finally { await ui.close(); }
});
test('compiled UI uses public file tree factory and validates a file without activation', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const promise = ui.service.open({ allowedTypes: ['file'], workspaceId: 'w', sessionId: 's' });
    await ui.render(); await ui.tick();
    assert.equal(ui.factoryCalls.at(-1).name, 'sidebar.files.tree');
    assert.equal(ui.factoryCalls.at(-1).input.root, '');
    const checkbox = ui.dom.window.document.querySelector('input[type=checkbox]');
    await React.act(async () => checkbox.click());
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Choose').click());
    const result = await promise;
    assert.equal(result.items[0].type, 'file'); assert.equal(result.items[0].path, 'a.txt');
    assert.equal(ui.calls.some(call => call.action === 'preview' || call.action === 'create-session'), false);
  } finally { await ui.close(); }
});
test('compiled UI enters files from a workspace without a session', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const promise = ui.service.open({ allowedTypes: ['workspace', 'file'], workspaceId: 'w' });
    await ui.render(); await ui.tick();
    const workspaceRow = [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent.includes('Project'));
    await React.act(async () => workspaceRow.click());
    await ui.tick();
    assert.equal(ui.factoryCalls.at(-1).name, 'sidebar.files.tree');
    const listing = ui.calls.find(call => call.action === 'files');
    assert.equal(listing.sessionId, undefined);
    const checkbox = ui.dom.window.document.querySelector('input[aria-label="Select a.txt"]');
    await React.act(async () => checkbox.click());
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Choose').click());
    const result = await promise;
    assert.equal(result.items[0].type, 'file'); assert.equal(result.items[0].path, 'a.txt'); assert.equal(result.items[0].sessionId, undefined);
    assert.equal(ui.calls.some(call => call.action === 'preview' || call.action === 'create-session'), false);
  } finally { await ui.close(); }
});
test('compiled UI renders Host failure and does not settle a selection', { skip: !upstream }, async () => {
  const ui = await setup({ failAction: 'validate' });
  try {
    const promise = ui.service.open({ allowedTypes: ['session'], workspaceId: 'w', sessionId: 's' });
    let settled = false; promise.then(() => { settled = true; });
    await ui.render(); await ui.tick();
    await React.act(async () => ui.dom.window.document.querySelector('input[type=checkbox]').click());
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Choose').click());
    assert.match(ui.dom.window.document.querySelector('[role=alert]').textContent, /Fixture refuses selection/);
    assert.equal(settled, false);
    await React.act(async () => [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
    assert.equal((await promise).status, 'cancelled');
  } finally { await ui.close(); }
});
test('compiled Client unload settles active and queued requests as disposed', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const first = ui.service.open(); const second = ui.service.open();
    await ui.render();
    await React.act(async () => ui.disposeOverlay());
    assert.equal((await first).reason, 'disposed'); assert.equal((await second).reason, 'disposed');
    assert.equal(ui.service.capabilities().overlay, false);
    assert.equal((await ui.service.open()).reason, 'disposed');
  } finally { await ui.close(); }
});
test('compiled UI Escape and caller abort are cancellation, not selection', { skip: !upstream }, async () => {
  const ui = await setup();
  try {
    const controller = new AbortController();
    const first = ui.service.open({}, { signal: controller.signal });
    await ui.render();
    await React.act(async () => controller.abort());
    assert.equal((await first).reason, 'aborted');
    let second;
    await React.act(async () => { second = ui.service.open(); });
    await React.act(async () => ui.dom.window.document.querySelector('[role=dialog]').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal((await second).reason, 'user');
    assert.equal(ui.calls.some(call => call.action === 'validate' || call.action === 'create-session'), false);
  } finally { await ui.close(); }
});
