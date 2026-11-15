import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import { Peer } from '@deepseek-ai/dsh-client-connection';
import * as picker from '../index.js';
import * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client';
import { clientContribution } from '../rpc.js';
async function setup() {
  const ctx = new Context();
  const calls = { list: 0, create: 0, events: 0 };
  const tools = new Map(), commands = new Map();
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(RemoteAccessService);
  await ctx.plugin(TypertGatewayService);
  ctx.provide('workspaceRegistry', { get: id => id === 'w' ? { id: 'w', title: 'Workspace', path: '/work', sessionIds: ['s'] } : undefined, list: () => [] });
  ctx.provide('sessionQuery', { listSessions: async () => { calls.list++; return []; }, observeSession: async () => ({ header: { id: 's', cwd: '/work' }, [Symbol.dispose]() {} }) });
  ctx.provide('sessionController', { modelCatalog: async () => ({ groups: [] }), create: async () => { calls.create++; return { sessionId: 'new' }; }, events: async () => { calls.events++; return { records: [], hasMore: false, cursor: 0 }; } });
  ctx.provide('tools', { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } });
  ctx.provide('commands', { register: definition => { commands.set(definition.name, definition); return () => commands.delete(definition.name); } });
  const fiber = ctx.plugin(picker); await fiber;
  return { ctx, fiber, calls, tools, commands };
}
test('real Client Gateway mounts the public namespace and revokes retained calls on dispose', async () => {
  const { ctx: host, calls } = await setup();
  const client = new Context();
  try {
    const owner = new Peer(host, { principal: { kind: 'owner' } });
    await client.plugin(TypertRegistry);
    client.provide('connection', {
      interactions: 'none', isLoopback: true,
      generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
      state: { getSnapshot: () => undefined, subscribe: () => () => {} },
      start: () => ({ stop() {} }), registerGenerationSource: () => () => {},
      rpc: {
        open: async function* () {},
        call: async (_path, endpoint, payload, signal) => {
          const [namespace, method] = endpoint.split('/');
          return { ok: true, value: await host.typertGateway.invoke({ peer: owner, namespace, method, args: payload.args, signal }) };
        },
      },
    });
    await client.plugin({ inject: ClientGateway.inject, apply: ClientGateway.apply });
    const assembly = client.plugin({ inject: ['remote'], apply: ctx => ctx.remote.$mount(clientContribution(z)) });
    await assembly;
    const remote = client.get('remote.resourcePicker');
    assert.equal(typeof remote.execute, 'function');
    const requestSchema = host.typert.local.get('resourcePicker/execute').parameters[0].codec.create();
    const projected = host.typert.toJSONSchema('@local/dsh-resource-picker#HostRequest');
    assert.equal(requestSchema.constructor.name, host.typert.resolve('@local/dsh-resource-picker#HostRequest').schema.constructor.name);
    assert.equal(projected.oneOf?.length ?? projected.anyOf?.length, 7);
    assert.throws(() => requestSchema.parse({ action: 'validate', options: { surprise: true }, items: [{ type: 'session', workspaceId: 'w', sessionId: 's' }] }));
    const result = await remote.execute({ action: 'catalog' });
    assert.equal(result.ok, true); assert.equal(result.value.ok, true); assert.equal(calls.list, 1);
    const retained = remote.execute;
    await assembly.dispose();
    assert.equal(client.get('remote.resourcePicker'), undefined);
    assert.equal((await retained({ action: 'catalog' })).ok, false); assert.equal(calls.list, 1);
  } finally { await client.fiber.dispose(); await host.fiber.dispose(); }
});
test('real Cordis and strict Gateway enforce service owner guard even with an allowed guest role', async () => {
  const { ctx, fiber, calls, tools, commands } = await setup();
  try {
    const owner = new Peer(ctx, { principal: { kind: 'owner' } });
    const guest = new Peer(ctx, { principal: { kind: 'picker-test-guest' } });
    ctx.remoteAccess.registerPolicy('picker-test-guest', { bindings: () => [{ resource: { kind: 'global' }, role: { name: 'allowed-for-test', resource: 'global', actions: ['resourcePicker/execute'] } }] });
    const invoke = (peer, request) => ctx.typertGateway.invoke({ peer, namespace: 'resourcePicker', method: 'execute', args: { request } });
    assert.equal((await invoke(owner, { action: 'catalog' })).ok, true);
    assert.equal(calls.list, 1);
    const denied = await invoke(guest, { action: 'catalog' });
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'owner-required'); assert.equal(calls.list, 1);
    const missingPrincipal = await ctx.extend({ invocation: { peer: {} } }).get('resourcePickerHost').execute({ action: 'catalog' });
    assert.equal(missingPrincipal.error.code, 'owner-required');
    const trusted = await ctx.get('resourcePickerHost').execute({ action: 'catalog' });
    assert.equal(trusted.ok, true); assert.equal(calls.list, 2);
    await assert.rejects(invoke(owner, { action: 'catalog', activate: true }));
    assert.equal(calls.create, 0); assert.equal(tools.size, 1); assert.equal(commands.size, 1);
    await fiber.dispose();
    assert.equal(ctx.get('resourcePickerHost'), undefined); assert.equal(ctx.typert.local.get('resourcePicker/execute'), undefined);
    assert.equal(tools.size, 0); assert.equal(commands.size, 0);
    await assert.rejects(invoke(owner, { action: 'catalog' }));
  } finally { await ctx.fiber.dispose(); }
});
