/** Pure selection rules shared by Host, Client and tests. No I/O or authority. */
export const RESOURCE_TYPES = Object.freeze(['workspace', 'session', 'file']);
export class PickerError extends Error {
  constructor(code, message) { super(message); this.name = 'PickerError'; this.code = code; }
}
export function nonempty(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/u.test(value)) throw new PickerError('invalid-input', `${field} must be a nonempty single-line string`);
  return value;
}
export function object(value, name = 'request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PickerError('invalid-input', `${name} must be an object`);
  return value;
}
export function relativePath(value = '') {
  if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n:]/u.test(value) || /^[\\/]/u.test(value)) throw new PickerError('invalid-path', 'Only workspace-relative paths are accepted');
  const parts = value.replaceAll('\\', '/').split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..')) throw new PickerError('invalid-path', 'Parent traversal is not accepted');
  return parts.join('/');
}
export function modelSelection(value) {
  object(value, 'modelSelection');
  const result = { provider: nonempty(value.provider, 'provider'), model: nonempty(value.model, 'model') };
  if (value.reasoningEffort !== undefined) result.reasoningEffort = nonempty(value.reasoningEffort, 'reasoningEffort');
  return result;
}
export function normalizeOptions(input = {}) {
  object(input, 'options');
  const allowedTypes = input.allowedTypes ?? [...RESOURCE_TYPES];
  if (!Array.isArray(allowedTypes) || !allowedTypes.length || allowedTypes.some(type => !RESOURCE_TYPES.includes(type))) throw new PickerError('invalid-types', 'allowedTypes must contain workspace, session or file');
  for (const key of ['multiple', 'allowMixed', 'allowParentChild', 'allowCreateSession', 'selectModel']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new PickerError('invalid-input', `${key} must be boolean`);
  const multiple = input.multiple ?? false;
  const max = input.maxSelections ?? (multiple ? 100 : 1);
  if (!Number.isSafeInteger(max) || max < 1 || max > 100) throw new PickerError('invalid-limit', 'maxSelections must be 1..100');
  const result = { allowedTypes: [...new Set(allowedTypes)], multiple, allowMixed: input.allowMixed ?? false, allowParentChild: input.allowParentChild ?? false, allowCreateSession: input.allowCreateSession ?? false, selectModel: input.selectModel ?? false, maxSelections: multiple ? max : 1 };
  for (const key of ['workspaceId', 'sessionId', 'agentPreset', 'title', 'commandSessionId']) if (input[key] !== undefined) result[key] = nonempty(input[key], key);
  if (input.modelSelection !== undefined) result.modelSelection = modelSelection(input.modelSelection);
  result.initialSelection = input.initialSelection === undefined ? [] : normalizeSelection(input.initialSelection, result);
  return result;
}
export function normalizeResource(input) {
  object(input, 'resource');
  if (!RESOURCE_TYPES.includes(input.type)) throw new PickerError('invalid-types', 'Unknown resource type');
  const item = { type: input.type, workspaceId: nonempty(input.workspaceId, 'workspaceId') };
  if (input.type === 'workspace') return { ...item, title: typeof input.title === 'string' ? input.title : input.workspaceId, path: typeof input.path === 'string' ? input.path : '' };
  if (input.type === 'session') {
    item.sessionId = nonempty(input.sessionId, 'sessionId');
    return { ...item, title: typeof input.title === 'string' ? input.title : item.sessionId, ...(input.agentPreset === undefined ? {} : { agentPreset: nonempty(input.agentPreset, 'agentPreset') }) };
  }
  if (input.sessionId !== undefined) item.sessionId = nonempty(input.sessionId, 'sessionId');
  const path = relativePath(input.path);
  if (!path) throw new PickerError('invalid-path', 'A file must have a relative path');
  return { ...item, path, name: path.split('/').at(-1) };
}
export function resourceKey(item) { return JSON.stringify([item.type, item.workspaceId, item.type === 'session' ? item.sessionId : null, item.type === 'file' ? item.path : null]); }
export function related(left, right) {
  if (left.workspaceId !== right.workspaceId) return false;
  if (left.type === 'workspace' || right.type === 'workspace') return true;
  return left.sessionId === right.sessionId && (left.type === 'session' || right.type === 'session');
}
export function normalizeSelection(input, options) {
  if (!Array.isArray(input)) throw new PickerError('invalid-input', 'items must be an array');
  if (input.length > options.maxSelections) throw new PickerError('selection-limit', 'Too many selected resources');
  const result = input.map(normalizeResource);
  if (result.some(item => !options.allowedTypes.includes(item.type))) throw new PickerError('type-not-allowed', 'A selected type is not allowed');
  if (new Set(result.map(resourceKey)).size !== result.length) throw new PickerError('duplicate', 'A resource was selected twice');
  if (!options.allowMixed && new Set(result.map(item => item.type)).size > 1) throw new PickerError('mixed-not-allowed', 'Mixed resource types are not allowed');
  if (!options.allowParentChild) for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) if (related(result[i], result[j])) throw new PickerError('parent-child-not-allowed', 'Parent and child resources cannot be selected together');
  return result;
}
export function toggleSelection(current, candidate, options) {
  const item = normalizeResource(candidate);
  const key = resourceKey(item);
  if (current.some(entry => resourceKey(entry) === key)) return current.filter(entry => resourceKey(entry) !== key);
  return normalizeSelection(options.multiple ? [...current, item] : [item], options);
}
/** Model choice is data only. Catalog validation never calls selectModel. */
export function validateModel(input, catalog) {
  const selection = modelSelection(input);
  const model = catalog.groups?.find(group => group.id === selection.provider)?.models.find(row => row.id === selection.model);
  if (!model) throw new PickerError('model-unavailable', 'Selected model is not in the current catalog');
  if (selection.reasoningEffort !== undefined && !model.reasoning?.efforts.some(effort => effort.id === selection.reasoningEffort)) throw new PickerError('effort-unavailable', 'Selected reasoning effort is not supported by this model');
  return selection;
}
/** Public text only. This is a labelled fallback, not the native Chat renderer. */
export function publicMessages(records, maxMessages = 40, maxChars = 48000) {
  let remaining = maxChars;
  const items = [];
  let truncated = false;
  for (const record of [...records].reverse()) {
    const event = record.event ?? record;
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue;
    const message = event.type === 'user/message' ? event.data : event.data?.message;
    if (!message || !Array.isArray(message.content)) continue;
    let text = message.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
    const media = message.content.filter(block => block.type === 'image' || block.type === 'file');
    const attachments = media.slice(0, 8).map(block => ({ type: block.type, name: String(block.attachment?.name ?? block.type).slice(0, 256) }));
    if (media.length > attachments.length) truncated = true;
    if (!text && !attachments.length) continue;
    if (items.length >= maxMessages || remaining <= 0) { truncated = true; break; }
    if (text.length > remaining) { text = text.slice(0, remaining); truncated = true; }
    remaining -= text.length;
    items.push({ seq: event.seq, time: event.time, role: event.type === 'user/message' ? 'user' : 'assistant', text, attachments, ...(message.source?.kind === 'model' ? { provider: message.source.provider, model: message.source.model } : {}) });
  }
  return { items: items.reverse(), truncated };
}
