import test from 'node:test';
import assert from 'node:assert/strict';
import { PickerQueue } from '../queue.js';
const item = { type: 'session', workspaceId: 'w', sessionId: 's', title: 'S' };
test('FIFO only lets the active request settle and cleans every abort listener', async () => {
  const queue = new PickerQueue(); queue.setAvailable(true);
  let calls = 0; const stop = queue.subscribe(() => calls++);
  const first = queue.open({ allowedTypes: ['session'] }); const id = queue.getSnapshot().id;
  const second = queue.open();
  assert.equal(queue.select(id + 1, [item]), false);
  assert.equal(queue.select(id, [item]), true);
  assert.equal((await first).status, 'selected');
  queue.cancel(queue.getSnapshot().id);
  assert.deepEqual(await second, { status: 'cancelled', reason: 'user' });
  assert.equal(queue.getSnapshot(), null); assert.equal(calls, 3); stop(); queue.dispose();
});
test('abort active or queued requests, unload and unavailable resolve cancellation', async () => {
  const queue = new PickerQueue();
  assert.deepEqual(await queue.open(), { status: 'cancelled', reason: 'disposed' });
  queue.setAvailable(true);
  const activeController = new AbortController(), queuedController = new AbortController();
  const first = queue.open({}, { signal: activeController.signal });
  const second = queue.open({}, { signal: queuedController.signal });
  queuedController.abort(); assert.equal((await second).reason, 'aborted');
  activeController.abort(); assert.equal((await first).reason, 'aborted');
  const third = queue.open(); queue.setAvailable(false); assert.equal((await third).reason, 'disposed');
  queue.setAvailable(true); const fourth = queue.open(); queue.dispose(); assert.equal((await fourth).reason, 'disposed');
});
test('caller input is captured and bad selection never resolves consent', async () => {
  const queue = new PickerQueue(); queue.setAvailable(true);
  const options = { allowedTypes: ['session'] };
  const promise = queue.open(options); options.allowedTypes.push('workspace');
  assert.throws(() => queue.select(queue.getSnapshot().id, []));
  assert.throws(() => queue.select(queue.getSnapshot().id, [{ type: 'workspace', workspaceId: 'w' }]));
  queue.cancel(queue.getSnapshot().id); assert.equal((await promise).status, 'cancelled');
  await assert.rejects(queue.open({ allowedTypes: [] }));
  queue.dispose();
});
