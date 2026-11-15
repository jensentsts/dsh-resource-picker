import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, executeForAgent } from '../host.js';
function fixture() {
  const counts = { activate: 0, create: 0, disposed: 0, events: 0, selectModel: 0, read: 0 };
  const ws = { id: 'w', title: 'Workspace', path: '/work', sessionIds: ['s'] };
  const header = { id: 's', cwd: '/work', createdAt: 1, agentPreset: 'default' };
  const ctx = {
    workspaceRegistry: { get: id => id === 'w' ? ws : undefined, list: () => [ws] },
    sessionQuery: {
      observeSession: async () => ({ header, [Symbol.dispose]: () => counts.disposed++ }),
      readTitle: async () => ({ title: 'Canonical' }), listSessions: async () => [{ header }],
    },
    sessionController: {
      create: async request => { counts.create++; assert.equal(request.workspaceId, 'w'); return { sessionId: 'new', agentPreset: request.agentPreset }; },
      resolveAgent: () => { counts.activate++; throw new Error('Unexpected activation'); },
      selectModel: () => { counts.selectModel++; },
      modelCatalog: async () => ({ default: { provider: 'p', model: 'm' }, groups: [{ id: 'p', models: [{ id: 'm' }] }] }),
      events: async request => { counts.events++; assert.equal(request.address.sessionId, 's'); return { records: [{ event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'Hello' }] } } }], cursor: 1, hasMore: false }; },
    },
    fs: {
      resolve: async path => ({ targetKey: path, path: path === 'escape' ? '/outside' : path.startsWith('/') ? path : `/work/${path}` }),
      contains: (root, child) => child.path === root.path || child.path.startsWith(`${root.path}/`),
      stat: async target => ({ type: target.path.endsWith('/folder') || target.path.endsWith('/.') ? 'directory' : 'file', size: 9 }),
      listDir: async target => [
        { name: 'folder', type: 'directory', target: { targetKey: `${target.path}/folder`, path: `${target.path}/folder` } },
        { name: 'a.txt', type: 'file', size: 9, target: { targetKey: `${target.path}/a.txt`, path: `${target.path}/a.txt` } },
      ],
      readBytes: async () => new TextEncoder().encode('File text'),
      readByteRange: async (_target, range) => new TextEncoder().encode('File text'.slice(0, range.length)),
    },
    workspaceFiles: {
      list: async scope => { assert.equal(scope.workspaceRoot, '/work'); return { entries: [{ name: 'a.txt', type: 'file' }], truncated: false }; },
      read: async (scope, path, range) => { counts.read++; assert.equal(scope.workspaceRoot, '/work'); assert.equal(path, 'a.txt'); assert.equal(range.limit, 120); return { text: 'a'.repeat(33000), eof: true }; },
    },
  };
  return { ctx, counts, operations: createOperations(ctx) };
}
test('passive preview never activates, creates, or changes a model', async () => {
  const { operations, counts } = fixture();
  const preview = await operations.perform({ action: 'preview', workspaceId: 'w', sessionId: 's' });
  assert.equal(preview.kind, 'text-fallback'); assert.equal(preview.items[0].text, 'Hello'); assert.equal(preview.nextBeforeSeq, 1);
  assert.equal(counts.events, 1); assert.equal(counts.disposed, 1);
  assert.equal(counts.activate + counts.create + counts.selectModel, 0);
});
test('canonical validation rejects wrong parent and replaces labels by authoritative IDs', async () => {
  const { operations } = fixture();
  const result = await operations.perform({ action: 'validate', options: { allowedTypes: ['session'] }, items: [{ type: 'session', workspaceId: 'w', sessionId: 's', title: 'Untrusted label' }] });
  assert.equal(result.items[0].title, 'Canonical'); assert.equal(result.items[0].agentPreset, 'default');
  await assert.rejects(operations.perform({ action: 'preview', workspaceId: 'w', sessionId: 'other' }), /belong/);
});
test('new session is explicit and passive catalog never creates it', async () => {
  const { operations, counts } = fixture();
  await operations.perform({ action: 'catalog' }); assert.equal(counts.create, 0);
  const result = await operations.perform({ action: 'create-session', workspaceId: 'w', agentPreset: 'p' });
  assert.equal(result.sessionId, 'new'); assert.equal(result.created, true); assert.equal(counts.create, 1);
});
test('canonical containment blocks symlink escape before official file reads', async () => {
  const { operations, counts } = fixture();
  await assert.rejects(operations.perform({ action: 'file-preview', workspaceId: 'w', sessionId: 's', path: 'escape' }), /outside/);
  assert.equal(counts.read, 0);
  const result = await operations.perform({ action: 'file-preview', workspaceId: 'w', sessionId: 's', path: 'a.txt' });
  assert.equal(result.text.length, 32000); assert.equal(result.truncated, true);
});
test('filesystem scope follows workspace identity even if a session cwd changes', async () => {
  const { operations, ctx } = fixture();
  ctx.sessionQuery.observeSession = async () => ({ header: { id: 's', cwd: '/outside/current' }, [Symbol.dispose]() {} });
  const listing = await operations.perform({ action: 'files', workspaceId: 'w', sessionId: 's', path: '' });
  assert.equal(listing.entries[0].name, 'a.txt');
  await operations.perform({ action: 'file-preview', workspaceId: 'w', sessionId: 's', path: 'a.txt' });
});
test('registered workspace files are browsable without a session or agent', async () => {
  const { operations, counts } = fixture();
  const listing = await operations.perform({ action: 'files', workspaceId: 'w', path: '' });
  assert.deepEqual(listing.entries.map(entry => entry.name), ['a.txt', 'folder']);
  assert.equal(listing.truncated, false);
  const preview = await operations.perform({ action: 'file-preview', workspaceId: 'w', path: 'a.txt' });
  assert.equal(preview.text, 'File text'); assert.equal(preview.truncated, false);
  const result = await operations.perform({ action: 'validate', options: { allowedTypes: ['file'] }, items: [{ type: 'file', workspaceId: 'w', path: 'a.txt' }] });
  assert.deepEqual(result.items[0], { type: 'file', workspaceId: 'w', path: 'a.txt', name: 'a.txt' });
  await assert.rejects(operations.perform({ action: 'file-preview', workspaceId: 'w', path: 'escape' }), /outside/);
  assert.equal(counts.disposed, 0); assert.equal(counts.create + counts.activate, 0);
});
test('abort before an operation has no side effects', async () => {
  const { operations, counts } = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(operations.perform({ action: 'create-session', workspaceId: 'w' }, controller.signal)); assert.equal(counts.create, 0);
});
test('tool and slash command share current-session read policy and reject wider authority', async () => {
  const { operations, ctx } = fixture(); const agent = { id: 's' };
  assert.equal((await executeForAgent(operations, ctx, { action: 'preview', workspaceId: 'w', sessionId: 's' }, agent)).ok, true);
  assert.equal((await executeForAgent(operations, ctx, { action: 'preview', workspaceId: 'w', sessionId: 'other' }, agent)).error.code, 'agent-scope-denied');
  assert.equal((await executeForAgent(operations, ctx, { action: 'create-session', workspaceId: 'w' }, agent)).error.code, 'agent-action-denied');
  assert.equal((await executeForAgent(operations, ctx, { action: 'files', workspaceId: 'w', sessionId: 's' }, agent)).error.code, 'agent-file-denied');
});
