/** Only nondeterministic workspace/session inputs are mocked. No file writes or network. */
export const name = 'resource-picker-fixture-external';
export function apply(ctx) {
  const calls = { list: 0, create: 0, events: 0 };
  ctx.provide('pickerFixtureCalls', calls);
  ctx.provide('workspaceRegistry', {
    get: id => id === 'w' ? { id: 'w', title: 'Fixture workspace', path: '/fixture', sessionIds: ['s'] } : undefined,
    list: () => [],
  });
  ctx.provide('sessionQuery', {
    listSessions: async () => { calls.list++; return []; },
    observeSession: async () => ({ header: { id: 's', cwd: '/fixture' }, [Symbol.dispose]() {} }),
  });
  ctx.provide('sessionController', {
    modelCatalog: async () => ({ groups: [] }),
    create: async () => { calls.create++; return { sessionId: 'new' }; },
    events: async () => { calls.events++; return { records: [], hasMore: false, cursor: 0 }; },
  });
}
