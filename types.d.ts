/** Public resource picker contract, version 1. IDs, not labels, are authoritative. */
export type ResourceType = 'workspace' | 'session' | 'file';
export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface WorkspaceResource { type: 'workspace'; workspaceId: string; title: string; path: string }
export interface SessionResource { type: 'session'; workspaceId: string; sessionId: string; title: string; agentPreset?: string }
export interface FileResource {
  type: 'file';
  workspaceId: string;
  /** Optional read scope. Omitted files are read from the registered workspace through the public fs API. */
  sessionId?: string;
  /** Workspace-relative path. */
  path: string;
  name: string;
}
export type Resource = WorkspaceResource | SessionResource | FileResource;
export interface PickerOptions {
  /** Defaults to all three types. An empty array is invalid. */
  allowedTypes?: ResourceType[];
  /** Defaults to false. A single selection never silently expands to a parent. */
  multiple?: boolean;
  /** Multiple different types are allowed only when true. Default false. */
  allowMixed?: boolean;
  /** A workspace and its session/file, or a session and its file, can coexist only when true. Default false. */
  allowParentChild?: boolean;
  /** Initial browsing location, not an implicit selection or permission grant. */
  workspaceId?: string;
  sessionId?: string;
  /** Initial checked resources. Every item is revalidated before acceptance. */
  initialSelection?: Resource[];
  /** Maximum selected resources, 1..100. Single mode always uses 1. */
  maxSelections?: number;
  /** Default false. New session is an explicit durable action; cancellation does not delete it. */
  allowCreateSession?: boolean;
  /** Preset used only by an explicit new-session action. Existing sessions retain theirs. */
  agentPreset?: string;
  /** Show a model and reasoning-effort selector. Selection is returned, never applied to an existing session. */
  selectModel?: boolean;
  modelSelection?: ModelSelection;
  /** Optional title shown verbatim as text, not HTML. */
  title?: string;
  /** Reserved compatibility hint. Ignored by v1; passive RPC never activates a command session. */
  commandSessionId?: string;
}
export type PickerResult = {
  status: 'selected'; items: Resource[]; modelSelection?: ModelSelection;
} | {
  status: 'cancelled'; reason: 'user' | 'aborted' | 'disposed';
};
export interface PickerCapabilities {
  overlay: boolean;
  nativeChatPreview: boolean;
  nativeFilePicker: false;
  workspaceFiles: boolean;
  createSession: boolean;
}
export interface ResourcePickerClient {
  readonly version: 1;
  capabilities(): PickerCapabilities;
  /** FIFO. Invalid options reject; user cancellation, caller abort and unload resolve cancelled. */
  open(options?: PickerOptions, exec?: { signal?: AbortSignal }): Promise<PickerResult>;
}
export type HostRequest =
  | { action: 'catalog' }
  | { action: 'models' }
  | { action: 'preview'; workspaceId: string; sessionId: string; beforeSeq?: number }
  | { action: 'validate'; options: PickerOptions; items: Resource[]; modelSelection?: ModelSelection }
  | { action: 'create-session'; workspaceId: string; agentPreset?: string }
  | { action: 'files'; workspaceId: string; sessionId?: string; path?: string }
  | { action: 'file-preview'; workspaceId: string; sessionId?: string; path: string };
export interface ResourcePickerHost {
  /** Trusted Host consumers. Remote execute is owner-only; tool/command reads are limited to the caller's current session and do not admit file operations. */
  execute(request: HostRequest, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>;
}
declare module '@deepseek-ai/cordis' {
  interface Context { resourcePicker: ResourcePickerClient; resourcePickerHost: ResourcePickerHost }
}
