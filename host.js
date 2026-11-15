import { PickerError, nonempty, normalizeResource, normalizeOptions, normalizeSelection, publicMessages, relativePath, validateModel } from './domain.js';
import { parseRequest, boundedOutcome } from './rpc.js';
const fail = (code, message) => { throw new PickerError(code, message); };
const check = signal => signal?.throwIfAborted();
/** Bounded package-level browsing for a workspace without a session. */
const MAX_ENTRIES = 200;
const MAX_PREVIEW_BYTES = 128 * 1024;
const MAX_PREVIEW_CHARS = 32000;
/** Trusted Host operations. Callers choose the appropriate authorization gate BEFORE entering. */
export function createOperations(ctx) {
  async function workspace(id) {
    const found = ctx.workspaceRegistry.get(nonempty(id, 'workspaceId'));
    if (!found) fail('workspace-not-found', 'The workspace is no longer registered');
    return found;
  }
  async function session(workspaceId, sessionId, signal) {
    const ws = await workspace(workspaceId);
    if (!ws.sessionIds.includes(sessionId)) fail('wrong-parent', 'The session does not belong to the selected workspace');
    const observation = await ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' });
    try {
      if (observation.header.origin === 'subagent') fail('subagent-not-supported', 'Subagent sessions must use the owning parent capability');
      return { ws, header: { ...observation.header } };
    } finally { observation[Symbol.dispose](); }
  }
  async function fileTarget(ws, path, signal) {
    const normalized = relativePath(path);
    const root = await ctx.fs.resolve(ws.path, { signal });
    const target = await ctx.fs.resolve(normalized || '.', { cwd: ws.path, signal });
    if (!ctx.fs.contains(root, target)) fail('outside-workspace', 'The selected path resolves outside this workspace');
    return { path: normalized, target };
  }
  async function fsList(ws, path, signal) {
    const { path: normalized, target } = await fileTarget(ws, path, signal);
    const info = await ctx.fs.stat(target, signal);
    if (!info) fail('not-found', 'The selected directory is absent');
    if (info.type !== 'directory') fail('not-directory', 'The selected path is not a directory');
    const all = (await ctx.fs.listDir(target, signal))
      .filter(entry => entry.name && !/[\\/]/u.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const entries = all.slice(0, MAX_ENTRIES).map(entry => ({ name: entry.name, type: entry.type, ...(entry.size === undefined ? {} : { size: entry.size }) }));
    return { path: normalized, entries, truncated: all.length > entries.length };
  }
  async function fsPreview(ws, path, signal) {
    const { path: normalized, target } = await fileTarget(ws, path, signal);
    const info = await ctx.fs.stat(target, signal);
    if (!info) fail('not-found', 'The selected file is absent');
    if (info.type !== 'file') fail('not-file', 'The selected path is not a regular file');
    const windowed = info.size !== undefined && info.size > MAX_PREVIEW_BYTES;
    const bytes = windowed
      ? await ctx.fs.readByteRange(target, { offset: 0, length: MAX_PREVIEW_BYTES }, signal)
      : await ctx.fs.readBytes(target, signal, MAX_PREVIEW_BYTES);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: !windowed }).decode(bytes); }
    catch { fail('binary-file', 'The selected file is not UTF-8 text'); }
    const bounded = text.slice(0, MAX_PREVIEW_CHARS);
    return { path: normalized, text: bounded, ...(info.size === undefined ? {} : { size: info.size }), truncated: windowed || bounded.length < text.length };
  }
  async function canonicalItem(input, signal) {
    const item = normalizeResource(input);
    const ws = await workspace(item.workspaceId);
    if (item.type === 'workspace') return { type: 'workspace', workspaceId: ws.id, title: ws.title, path: ws.path };
    if (item.type === 'session') {
      const { header } = await session(ws.id, item.sessionId, signal);
      const title = await ctx.sessionQuery.readTitle(item.sessionId, signal);
      return { type: 'session', workspaceId: ws.id, sessionId: item.sessionId, title: title?.title ?? item.sessionId, ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }) };
    }
    if (item.sessionId !== undefined) await session(ws.id, item.sessionId, signal);
    const { path, target } = await fileTarget(ws, item.path, signal);
    const stat = await ctx.fs.stat(target, signal);
    if (stat?.type !== 'file') fail('not-file', 'The selected file is absent or is not a regular file');
    return { type: 'file', workspaceId: ws.id, ...(item.sessionId === undefined ? {} : { sessionId: item.sessionId }), path, name: path.split('/').at(-1) };
  }
  async function perform(raw, signal) {
    const request = parseRequest(raw);
    check(signal);
    switch (request.action) {
      case 'catalog': {
        const records = await ctx.sessionQuery.listSessions(signal);
        const ordinary = new Map(records.filter(record => record.header.origin !== 'subagent').map(record => [record.header.id, record]));
        const workspaces = ctx.workspaceRegistry.list().map(ws => ({ workspaceId: ws.id, title: ws.title, path: ws.path, sessionIds: ws.sessionIds.filter(id => ordinary.has(id)) }));
        // Titles are already provided by the official Client useSessions hook; do not cold-read every log here.
        return { workspaces, sessions: records.filter(record => record.header.origin !== 'subagent').map(record => ({ sessionId: record.header.id, createdAt: record.header.createdAt, ...(record.header.agentPreset === undefined ? {} : { agentPreset: record.header.agentPreset }) })) };
      }
      case 'models': return ctx.sessionController.modelCatalog();
      case 'preview': {
        const { header } = await session(request.workspaceId, request.sessionId, signal);
        // Official cold page reads use sessionQuery. No resolveAgent, retain, follow(activate), resume or create.
        const page = await ctx.sessionController.events({ address: { kind: 'session', sessionId: request.sessionId }, maxMessages: 40, ...(request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq }) }, signal ?? new AbortController().signal);
        const messages = publicMessages(page.records);
        return { kind: 'text-fallback', sessionId: request.sessionId, header, ...messages, hasMore: page.hasMore, cursor: page.cursor, ...(page.records.length ? { nextBeforeSeq: page.records[0].event.seq } : {}) };
      }
      case 'validate': {
        const options = normalizeOptions(request.options);
        const items = normalizeSelection(request.items, options);
        const canonical = [];
        for (const item of items) { check(signal); canonical.push(await canonicalItem(item, signal)); }
        let modelSelection;
        if (options.selectModel && request.modelSelection !== undefined) modelSelection = validateModel(request.modelSelection, await ctx.sessionController.modelCatalog());
        check(signal);
        return { items: canonical, ...(modelSelection === undefined ? {} : { modelSelection }) };
      }
      case 'create-session': {
        const ws = await workspace(request.workspaceId);
        check(signal);
        // A durable, explicit user operation. No prompt, model call or policy change is made here.
        const created = await ctx.sessionController.create({ workspaceId: ws.id, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) });
        return { type: 'session', workspaceId: ws.id, sessionId: created.sessionId, title: created.sessionId, ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }), created: true };
      }
      case 'files': {
        if (!ctx.fs) fail('files-unavailable', 'The official workspace filesystem capability is not composed');
        if (request.sessionId !== undefined) {
          const { ws } = await session(request.workspaceId, request.sessionId, signal);
          if (ctx.workspaceFiles) {
            const { path } = await fileTarget(ws, request.path, signal);
            return ctx.workspaceFiles.list({ sessionId: request.sessionId, workspaceRoot: ws.path }, path || '.', signal ?? new AbortController().signal);
          }
          return fsList(ws, request.path, signal);
        }
        return fsList(await workspace(request.workspaceId), request.path, signal);
      }
      case 'file-preview': {
        if (!ctx.fs) fail('files-unavailable', 'The official workspace filesystem capability is not composed');
        if (request.sessionId !== undefined) {
          const { ws } = await session(request.workspaceId, request.sessionId, signal);
          if (ctx.workspaceFiles) {
            const { path } = await fileTarget(ws, request.path, signal);
            const result = await ctx.workspaceFiles.read({ sessionId: request.sessionId, workspaceRoot: ws.path }, path, { offset: 1, limit: 120 }, signal ?? new AbortController().signal);
            const text = result.text.slice(0, MAX_PREVIEW_CHARS);
            return { ...result, text, truncated: !result.eof || text.length < result.text.length };
          }
          return fsPreview(ws, request.path, signal);
        }
        return fsPreview(await workspace(request.workspaceId), request.path, signal);
      }
      default: fail('invalid-input', 'Unsupported action');
    }
  }
  return { perform, canonicalItem };
}
export function outcomeError(error) {
  return { ok: false, error: { code: typeof error?.code === 'string' ? error.code : error?.name === 'AbortError' ? 'cancelled' : 'operation-failed', message: error instanceof Error ? error.message.slice(0, 4096) : 'The operation failed' } };
}
/** A command has only the receiving Agent's authority, not a cross-session owner identity. */
export async function executeForAgent(operations, ctx, raw, agent, signal) {
  try {
    const request = parseRequest(raw);
    if (!agent) fail('agent-required', 'This operation needs a receiving session');
    const allowed = ['preview', 'files', 'file-preview', 'validate'];
    if (!allowed.includes(request.action)) fail('agent-action-denied', 'Use the owner-only picker UI or trusted Host service for catalog, model catalog and creation');
    if (request.action === 'validate') {
      if (request.items.some(item => item.type === 'workspace' || item.sessionId !== agent.id)) fail('agent-scope-denied', 'Agent callers may validate only their own session or its files');
      if (request.modelSelection !== undefined) fail('agent-action-denied', 'Model catalog validation is owner-only');
    } else if (request.sessionId !== agent.id) fail('agent-scope-denied', 'Agent callers may read only their current session');
    // A model-facing file read must also use the Agent filesystem's normal policy. Avoid root-owned file operations here.
    if (request.action === 'files' || request.action === 'file-preview' || request.action === 'validate' && request.items.some(item => item.type === 'file')) fail('agent-file-denied', 'Use the ordinary filesystem tools for file reads and validation under this Agent\'s policy');
    return boundedOutcome({ ok: true, value: await operations.perform(request, signal) });
  } catch (error) { return outcomeError(error); }
}
