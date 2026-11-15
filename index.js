import { Service } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { createOperations, executeForAgent, outcomeError } from './host.js';
import { hostContribution, boundedOutcome } from './rpc.js';

export const name = 'dsh-resource-picker';
export const inject = ['workspaceRegistry', 'sessionQuery', 'sessionController', 'typert'];

/** Public Host service. Gateway calls carry the current peer on this.ctx.invocation. */
export class ResourcePickerHost extends Service {
  constructor(ctx) {
    super(ctx, 'resourcePickerHost');
    this.typertRemote = bindTypertRemote(this, 'resourcePickerHost', { namespace: 'resourcePicker' });
    this.operations = createOperations({
      workspaceRegistry: ctx.workspaceRegistry, sessionQuery: ctx.sessionQuery,
      sessionController: ctx.sessionController, fs: ctx.get('fs'), workspaceFiles: ctx.get('workspaceFiles'),
    });
  }
  /** Owner-only wire entry and trusted in-process Host entry. No capability grants. */
  async execute(request, signal) {
    try {
      const invocation = this.ctx.invocation;
      if (invocation !== undefined && invocation.peer?.principal?.kind !== 'owner') return { ok: false, error: { code: 'owner-required', message: 'This picker endpoint is owner-only. Use the official resource APIs under your peer permissions.' } };
      return boundedOutcome({ ok: true, value: await this.operations.perform(request, signal) });
    } catch (error) { return outcomeError(error); }
  }
}
const parameters = {
  type: 'object', properties: {
    action: { type: 'string', enum: ['preview', 'validate'], description: 'Preview the current session or validate a reference to it.' },
    workspaceId: { type: 'string', description: 'Required for preview: registered workspace containing this session.' },
    sessionId: { type: 'string', description: 'Required for preview: this tool caller\'s current session ID.' },
    beforeSeq: { type: 'integer', description: 'Preview only: optional exclusive cursor from nextBeforeSeq.' },
    options: {
      type: 'object', description: 'Required for validate. Restrict to a single session reference.',
      properties: { allowedTypes: { type: 'array', items: { type: 'string', enum: ['session'] } } }, additionalProperties: false,
    },
    items: {
      type: 'array', description: 'Required for validate: one current-session reference.', minItems: 1, maxItems: 1,
      items: { type: 'object', properties: { type: { type: 'string', enum: ['session'] }, workspaceId: { type: 'string' }, sessionId: { type: 'string' }, title: { type: 'string', description: 'Optional label; the result replaces it with the current stored title.' } }, required: ['type', 'workspaceId', 'sessionId'], additionalProperties: false },
    },
  }, required: ['action'], additionalProperties: false,
};
/** Register one operation for trusted UI/Host consumers and constrained agent consumers. */
export function apply(ctx) {
  const service = new ResourcePickerHost(ctx);
  ctx.effect(() => ctx.typert.register(hostContribution(z)), 'resource-picker: Host RPC');
  ctx.inject(['commands'], commandCtx => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: 'resource-picker', description: 'Preview this session or validate its reference. JSON input; no navigation or model activation.',
      input: { hint: '{"action":"preview","workspaceId":"…","sessionId":"…"}' }, recordInput: false,
      handler: async invocation => {
        let request;
        try { request = JSON.parse(invocation.rawInput); } catch (error) { return { kind: 'error', text: `Invalid JSON: ${error.message}` }; }
        const result = await executeForAgent(service.operations, ctx, request, invocation.agent, invocation.signal);
        return { kind: result.ok ? 'success' : 'error', text: JSON.stringify(result) };
      },
    }), 'resource-picker: command');
  });
  ctx.inject(['tools'], toolCtx => {
    toolCtx.effect(() => toolCtx.tools.register({
      name: 'resource_picker_read', deferLoading: true,
      description: 'Read a bounded public-text preview of the current session or validate a reference to it. Does not navigate, create a session, or change model or permissions.',
      parameters,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (request, exec) => executeForAgent(service.operations, ctx, request, exec.agent, exec.signal),
      isConcurrencySafe: () => true,
      presentCall: args => ({ card: 'generic', title: 'Resource preview', kind: 'read', rawInput: args }),
    }), 'resource-picker: read tool');
  });
}
