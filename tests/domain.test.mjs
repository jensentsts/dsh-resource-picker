import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions, normalizeSelection, normalizeResource, toggleSelection, relativePath, publicMessages, validateModel, resourceKey } from '../domain.js';
import { parseRequest, remoteDescriptor, hostContribution, boundedOutcome, wireBytes, MAX_WIRE_BYTES } from '../rpc.js';
const ws = { type: 'workspace', workspaceId: 'w', title: 'A', path: 'E:/A' };
const session = { type: 'session', workspaceId: 'w', sessionId: 's', title: 'B' };
const file = { type: 'file', workspaceId: 'w', sessionId: 's', path: 'dir/a.txt', name: 'a.txt' };

test('defaults permit types, not mixed parents, creation or multiple selection', () => {
  const options = normalizeOptions();
  assert.deepEqual(options.allowedTypes, ['workspace', 'session', 'file']);
  assert.equal(options.multiple, false); assert.equal(options.maxSelections, 1);
  assert.equal(options.allowMixed, false); assert.equal(options.allowParentChild, false); assert.equal(options.allowCreateSession, false);
});
test('reject invalid types, flags, limits and empty IDs', () => {
  for (const options of [{ allowedTypes: [] }, { allowedTypes: ['directory'] }, { multiple: 'yes' }, { maxSelections: 0 }, { workspaceId: '' }, { sessionId: 'a\nb' }, { modelSelection: { provider: '', model: 'a' } }]) assert.throws(() => normalizeOptions(options));
  assert.deepEqual(normalizeOptions({ allowedTypes: ['session', 'session'], multiple: true, maxSelections: 8 }).allowedTypes, ['session']);
});
test('single selection replaces and second toggle removes', () => {
  const options = normalizeOptions();
  assert.deepEqual(toggleSelection([ws], session, options), [session]);
  assert.deepEqual(toggleSelection([session], session, options), []);
});
test('mixed types and parent-child choices are independently enforced', () => {
  assert.throws(() => normalizeSelection([ws, session], normalizeOptions({ multiple: true })), /Mixed/);
  assert.throws(() => normalizeSelection([ws, session], normalizeOptions({ multiple: true, allowMixed: true })), /Parent/);
  assert.deepEqual(normalizeSelection([ws, session, file], normalizeOptions({ multiple: true, allowMixed: true, allowParentChild: true })), [ws, session, file]);
  assert.equal(normalizeSelection([session, { ...session, sessionId: 's2' }], normalizeOptions({ multiple: true })).length, 2);
});
test('disallowed, duplicate, excessive and malformed selections reject', () => {
  assert.throws(() => normalizeSelection([ws], normalizeOptions({ allowedTypes: ['session'] })));
  assert.throws(() => normalizeSelection([session, session], normalizeOptions({ multiple: true })), /twice/);
  assert.throws(() => normalizeSelection([session, { ...session, sessionId: 's2' }], normalizeOptions()), /Too many/);
  assert.throws(() => normalizeResource({ ...file, path: '' }));
});
test('files remain relative and names cannot escape or inject drives', () => {
  assert.equal(relativePath('a\\b/./c'), 'a/b/c');
  assert.equal(relativePath(''), '');
  for (const path of ['../a', 'a/../b', '/a', '\\server\\a', 'C:/x', 'a\0b', 'a\nb']) assert.throws(() => relativePath(path));
  assert.notEqual(resourceKey({ ...file, path: 'a/b' }), resourceKey({ ...file, path: 'a', sessionId: 's/b' }));
  assert.equal(resourceKey(file), resourceKey({ ...file, sessionId: 'another' }));
  assert.throws(() => normalizeSelection([file, { ...file, sessionId: 'another' }], normalizeOptions({ multiple: true })), /twice/);
  assert.equal(normalizeResource({ type: 'file', workspaceId: 'w', path: 'a.txt' }).sessionId, undefined);
  assert.throws(() => normalizeResource({ type: 'session', workspaceId: 'w' }));
  assert.throws(() => normalizeResource({ type: 'file', workspaceId: 'w', sessionId: null, path: 'a.txt' }));
});
test('model choice rejects unsupported routes and effort without changing catalog', () => {
  const catalog = { groups: [{ id: 'p', models: [{ id: 'm', reasoning: { efforts: [{ id: 'high' }] } }] }] };
  const before = JSON.stringify(catalog);
  assert.deepEqual(validateModel({ provider: 'p', model: 'm' }, catalog), { provider: 'p', model: 'm' });
  assert.deepEqual(validateModel({ provider: 'p', model: 'm', reasoningEffort: 'high' }, catalog), { provider: 'p', model: 'm', reasoningEffort: 'high' });
  assert.throws(() => validateModel({ provider: 'q', model: 'm' }, catalog));
  assert.throws(() => validateModel({ provider: 'p', model: 'm', reasoningEffort: 'low' }, catalog));
  assert.equal(JSON.stringify(catalog), before);
});
test('preview projects public text only and labels truncation', () => {
  const events = [
    { type: 'system/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'SECRET' }] } } },
    { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: 'Hello' }] } },
    { type: 'assistant/message', seq: 3, data: { message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'reasoning', text: 'SECRET' }, { type: 'text', text: 'World' }, { type: 'image', attachment: { name: 'pic.png' } }] } } },
    { type: 'tool/result', seq: 4, data: { message: { content: [{ type: 'text', text: 'SECRET' }] } } },
  ];
  const result = publicMessages(events);
  assert.deepEqual(result.items.map(row => row.text), ['Hello', 'World']);
  assert.equal(result.items[1].attachments[0].name, 'pic.png');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(publicMessages(events, 1).truncated, true);
  assert.equal(publicMessages(events, 40, 2).items[0].text, 'Wo');
});
test('complete response envelope is UTF-8 bounded including wrapper overhead', () => {
  const small = { ok: true, value: { text: '' } };
  const overhead = wireBytes(small);
  const exact = { ok: true, value: { text: 'a'.repeat(MAX_WIRE_BYTES - overhead) } };
  assert.equal(wireBytes(exact), MAX_WIRE_BYTES);
  assert.equal(boundedOutcome(exact).ok, true);
  exact.value.text += 'a';
  assert.equal(boundedOutcome(exact).error.code, 'result-too-large');
  assert.equal(boundedOutcome({ ok: true, value: { text: '汉'.repeat(180000) } }).error.code, 'result-too-large');
  assert.throws(() => parseRequest({ action: 'catalog', ignored: 'x'.repeat(140000) }), /128 KiB/);
});
test('strict request schema rejects unrelated fields and preserves cancellation metadata', () => {
  assert.throws(() => parseRequest({ action: 'catalog', activate: true }));
  assert.throws(() => parseRequest({ action: 'preview', workspaceId: 'w', sessionId: 's', beforeSeq: -1 }));
  assert.throws(() => parseRequest({ action: 'validate', options: {}, items: [] }));
  assert.throws(() => parseRequest({ action: 'file-preview', workspaceId: 'w', sessionId: 's' }));
  assert.throws(() => parseRequest({ action: 'preview', workspaceId: 'w' }));
  assert.equal(parseRequest({ action: 'files', workspaceId: 'w' }).sessionId, undefined);
  assert.equal(parseRequest({ action: 'file-preview', workspaceId: 'w', path: 'a.txt' }).sessionId, undefined);
  assert.equal(remoteDescriptor().parameters[0].codec.mode, 'strict');
  assert.equal(remoteDescriptor().cancellation.parameter, 'signal');
  assert.equal(hostContribution().invocations[0].namespace, 'resourcePicker');
});
