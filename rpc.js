import { object, nonempty, relativePath, normalizeOptions, normalizeSelection, modelSelection, PickerError } from './domain.js';
export const PACKAGE_NAME = '@local/dsh-resource-picker';
export const MAX_WIRE_BYTES = 512 * 1024;
/** Bound the complete JSON envelope, including labels, attachments and wrappers. */
export function wireBytes(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function boundedOutcome(value) {
  object(value, 'outcome');
  if (typeof value.ok !== 'boolean' || value.ok && !Object.hasOwn(value, 'value') || !value.ok && (!value.error || typeof value.error.code !== 'string' || typeof value.error.message !== 'string')) throw new PickerError('invalid-result', 'Invalid picker outcome');
  if (wireBytes(value) > MAX_WIRE_BYTES) return { ok: false, error: { code: 'result-too-large', message: 'The resource result exceeds the 512 KiB response limit. Narrow the resource or read a smaller page.' } };
  return value;
}
/** Strict request admission shared by Typert, the Host service, slash command and tool. */
export function parseRequest(value) {
  object(value);
  if (wireBytes(value) > 128 * 1024) throw new PickerError('request-too-large', 'Picker requests must not exceed 128 KiB');
  const shapes = {
    catalog: ['action'], models: ['action'],
    preview: ['action', 'workspaceId', 'sessionId', 'beforeSeq'],
    validate: ['action', 'options', 'items', 'modelSelection'],
    'create-session': ['action', 'workspaceId', 'agentPreset'],
    files: ['action', 'workspaceId', 'sessionId', 'path'],
    'file-preview': ['action', 'workspaceId', 'sessionId', 'path'],
  };
  const keys = shapes[value.action];
  if (!keys || Object.keys(value).some(key => !keys.includes(key))) throw new PickerError('invalid-input', 'Unknown action or undeclared request field');
  const result = { action: value.action };
  if (keys.includes('workspaceId')) result.workspaceId = nonempty(value.workspaceId, 'workspaceId');
  if (keys.includes('sessionId') && value.sessionId !== undefined) result.sessionId = nonempty(value.sessionId, 'sessionId');
  if (value.action === 'preview' && result.sessionId === undefined) throw new PickerError('invalid-input', 'sessionId is required for a preview');
  if (keys.includes('path')) result.path = relativePath(value.path ?? '');
  if (value.action === 'file-preview' && !result.path) throw new PickerError('invalid-path', 'Choose a file');
  if (value.beforeSeq !== undefined) {
    if (!Number.isSafeInteger(value.beforeSeq) || value.beforeSeq < 0) throw new PickerError('invalid-input', 'beforeSeq must be a non-negative integer');
    result.beforeSeq = value.beforeSeq;
  }
  if (value.agentPreset !== undefined) result.agentPreset = nonempty(value.agentPreset, 'agentPreset');
  if (value.action === 'validate') {
    result.options = normalizeOptions(value.options);
    result.items = normalizeSelection(value.items, result.options);
    if (!result.items.length) throw new PickerError('empty-selection', 'Choose at least one resource');
    if (value.modelSelection !== undefined) result.modelSelection = modelSelection(value.modelSelection);
  }
  return result;
}
/** Real Zod schemas are created by the Host/Client assembly from its shared library identity. */
function schemas(z) {
  const id = () => z.string().min(1).max(4096).regex(/^[^\0\r\n]+$/u);
  const model = z.strictObject({ provider: id(), model: id(), reasoningEffort: id().optional() });
  const resource = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('workspace'), workspaceId: id(), title: z.string().optional(), path: z.string().optional() }),
    z.strictObject({ type: z.literal('session'), workspaceId: id(), sessionId: id(), title: z.string().optional(), agentPreset: id().optional() }),
    z.strictObject({ type: z.literal('file'), workspaceId: id(), sessionId: id().optional(), path: id(), name: z.string().optional() }),
  ]);
  const options = z.strictObject({
    allowedTypes: z.array(z.enum(['workspace', 'session', 'file'])).min(1).optional(),
    multiple: z.boolean().optional(), allowMixed: z.boolean().optional(), allowParentChild: z.boolean().optional(),
    workspaceId: id().optional(), sessionId: id().optional(), initialSelection: z.array(resource).max(100).optional(),
    maxSelections: z.number().int().min(1).max(100).optional(), allowCreateSession: z.boolean().optional(),
    agentPreset: id().optional(), selectModel: z.boolean().optional(), modelSelection: model.optional(),
    title: id().optional(), commandSessionId: id().optional(),
  });
  const request = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('catalog') }), z.strictObject({ action: z.literal('models') }),
    z.strictObject({ action: z.literal('preview'), workspaceId: id(), sessionId: id(), beforeSeq: z.number().int().min(0).optional() }),
    z.strictObject({ action: z.literal('validate'), options, items: z.array(resource).min(1).max(100), modelSelection: model.optional() }),
    z.strictObject({ action: z.literal('create-session'), workspaceId: id(), agentPreset: id().optional() }),
    z.strictObject({ action: z.literal('files'), workspaceId: id(), sessionId: id().optional(), path: z.string().optional() }),
    z.strictObject({ action: z.literal('file-preview'), workspaceId: id(), sessionId: id().optional(), path: id() }),
  ]).superRefine((value, ctx) => {
    try { parseRequest(value); } catch (error) { ctx.addIssue({ code: 'custom', message: error.message }); }
  });
  const outcome = z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: z.json() }),
    z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: id(), message: z.string().max(4096) }) }),
  ]).refine(value => wireBytes(value) <= MAX_WIRE_BYTES, 'Picker outcome exceeds the complete response limit');
  return { request, outcome };
}
/** Explicit strict codecs, authored against the public InvocationDescriptor contract. */
export function remoteDescriptor(z) {
  const requestCodec = { mode: 'strict', typeSymbol: 'ResourcePickerRequest', create: () => schemas(z).request };
  const resultCodec = { mode: 'strict', typeSymbol: 'ResourcePickerOutcome', create: () => schemas(z).outcome, encode: boundedOutcome };
  return {
    id: `${PACKAGE_NAME}#resourcePicker/execute`, service: 'resourcePickerHost', namespace: 'resourcePicker', method: 'execute',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: requestCodec }],
    cancellation: { parameter: 'signal' }, result: resultCodec,
    description: 'Read and validate resources, or explicitly create a session. Owner-only; no authority or permission changes.',
  };
}
export function hostContribution(z) {
  return {
    package: PACKAGE_NAME, face: 'host', schemas: [
      { name: 'HostRequest', create: () => schemas(z).request },
      { name: 'Outcome', create: () => schemas(z).outcome },
    ], invocations: [remoteDescriptor(z)],
    model: { services: [{ key: 'resourcePickerHost', exportName: 'ResourcePickerHost', tags: [], members: [{ kind: 'method', name: 'execute', signature: 'execute(request: HostRequest, signal?: AbortSignal): Promise<Outcome>', summary: 'Owner-only resource operations; never creates during preview.' }], types: [] }], events: [], objects: [] },
  };
}
export function clientContribution(z) { return { package: PACKAGE_NAME, descriptors: [remoteDescriptor(z)] }; }
