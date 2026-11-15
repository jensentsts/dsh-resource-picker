import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, FiberState } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import { Peer } from '@deepseek-ai/dsh-client-connection';

test('official Loader and Include compose the fixture file, enforce owner access and dispose the package', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(Loader);
    ctx.loader.builtins.include = Include;
    await ctx.loader.create({ name: 'cordis:include', config: { path: new URL('./fixtures/cordis.yml', import.meta.url).href } });
    await ctx.loader.await();
    const entries = [...ctx.loader.entries()];
    for (const id of ['typert', 'remote-access', 'gateway', 'resource-picker']) {
      const entry = entries.find(candidate => candidate.options.id === id);
      assert.ok(entry, `Loader entry ${id}`);
      assert.equal(entry.fiber?.state, FiberState.ACTIVE, `Active Loader entry ${id}`);
    }
    const owner = new Peer(ctx, { principal: { kind: 'owner' } });
    const guest = new Peer(ctx, { principal: { kind: 'picker-loader-guest' } });
    ctx.remoteAccess.registerPolicy('picker-loader-guest', { bindings: () => [{ resource: { kind: 'global' }, role: { name: 'fixture-allow', resource: 'global', actions: ['resourcePicker/execute'] } }] });
    const invoke = (peer, request) => ctx.typertGateway.invoke({ peer, namespace: 'resourcePicker', method: 'execute', args: { request } });
    assert.equal((await invoke(owner, { action: 'catalog' })).ok, true);
    assert.equal(ctx.get('pickerFixtureCalls').list, 1);
    assert.equal((await invoke(guest, { action: 'catalog' })).error.code, 'owner-required');
    assert.equal(ctx.get('pickerFixtureCalls').list, 1);
    const preview = await invoke(owner, { action: 'preview', workspaceId: 'w', sessionId: 's' });
    assert.equal(preview.ok, true); assert.equal(preview.value.kind, 'text-fallback');
    assert.equal(ctx.get('pickerFixtureCalls').create, 0);
    const entry = entries.find(candidate => candidate.options.id === 'resource-picker');
    // Unregister the plugin generation, not self-dispose the entry (the latter persists disabled:true).
    await ctx.registry.delete(entry.fiber.runtime.callback);
    assert.equal(ctx.get('resourcePickerHost'), undefined);
    assert.equal(ctx.typert.local.get('resourcePicker/execute'), undefined);
    await assert.rejects(invoke(owner, { action: 'catalog' }));
  } finally { await ctx.fiber.dispose(); }
});
