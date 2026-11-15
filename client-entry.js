import React from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { z } from 'zod';
import { PickerQueue } from './queue.js';
import { clientContribution } from './rpc.js';
import { toggleSelection, resourceKey } from './domain.js';
import { css } from './style.js';
import en from './locale/en.json';
import zh from './locale/zh.json';
const h = React.createElement;
const NS = 'local.resourcePicker';
const PROTOCOL = 'local-resource-picker';
const labelOf = item => item.type === 'file' ? item.name : item.title;
function address(request, generation = 0) { return request ? `dsh-resource://${PROTOCOL}/${encodeURIComponent(JSON.stringify(request))}?g=${generation}` : ''; }
function Skeleton() { return h('div', { className: 'dsrp-skeleton', 'aria-busy': true }, ...Array.from({ length: 6 }, (_, index) => h('span', { key: index }))); }
function Notice({ state, t }) {
  if (state.status === 'loading') return h(Skeleton);
  if (state.status === 'failed') return h('p', { className: 'dsrp-error', role: 'alert' }, state.failure?.message ?? t('failed'));
  if (state.value?.ok === false) return h('p', { className: 'dsrp-error', role: 'alert' }, t('operationError', { message: state.value.error.message }));
  if (state.status === 'none') return h('p', { className: 'dsrp-empty' }, t('unavailable'));
  return null;
}
function ResourceRow({ item, detail, active, selected, selectable, onBrowse, onToggle, t }) {
  const title = labelOf(item);
  return h('div', { className: 'dsrp-row', 'data-active': active },
    selectable && h('input', { type: 'checkbox', checked: selected, 'aria-label': t('select', { name: title }), onChange: () => onToggle(item) }),
    h('button', { type: 'button', className: 'dsrp-row-main', title: detail || title, onClick: onBrowse },
      h('span', { className: 'dsrp-row-title' }, title),
      h('span', { className: 'dsrp-row-detail' }, detail)));
}
function Preview({ workspaceId, sessionId, useResource, renderFactorySlot, t }) {
  return renderFactorySlot('conversation.preview', { sessionId, readOnly: true }, {
    fallback: h(TextPreview, { workspaceId, sessionId, useResource, t }),
  });
}
function TextPreview({ workspaceId, sessionId, useResource, t }) {
  const [page, setPage] = React.useState({ beforeSeq: undefined, generation: 0 });
  const state = useResource(address({ action: 'preview', workspaceId, sessionId, ...(page.beforeSeq === undefined ? {} : { beforeSeq: page.beforeSeq }) }, page.generation));
  const preview = state.value?.ok ? state.value.value : undefined;
  return h(React.Fragment, null,
    h('div', { className: 'dsrp-column-head' }, h('p', { className: 'dsrp-note' }, t('fallbackPreview')),
      h('div', { className: 'dsrp-column-top' },
        h('button', { type: 'button', onClick: () => setPage({ beforeSeq: undefined, generation: page.generation + 1 }) }, t('refresh')),
        preview?.hasMore && h('button', { type: 'button', disabled: preview.nextBeforeSeq === undefined || preview.nextBeforeSeq === page.beforeSeq, onClick: () => setPage({ beforeSeq: preview.nextBeforeSeq, generation: page.generation }) }, t('older')))),
    h('div', { className: 'dsrp-preview-content' }, h(Notice, { state, t }),
      preview && (preview.items.length ? preview.items.map(message => h('article', { className: 'dsrp-message', key: message.seq },
        h('div', { className: 'dsrp-message-head' }, h('strong', null, t(message.role)), message.model && h('span', null, message.model), h('span', null, `#${message.seq}`)),
        h('p', null, message.text), ...message.attachments.map((attachment, index) => h('div', { className: 'dsrp-attachment', key: index }, `${t(attachment.type === 'image' ? 'file' : attachment.type)}: ${attachment.name}`)))) : h('p', { className: 'dsrp-empty' }, t('emptyPreview'))),
      preview?.truncated && h('p', { className: 'dsrp-note' }, t('truncatedPreview'))));
}
function Files({ workspaceId, sessionId, selected, onToggle, useResource, useSessionAccess, renderFactorySlot, t }) {
  const [path, setPath] = React.useState('');
  const [file, setFile] = React.useState(null);
  const [generation, setGeneration] = React.useState(0);
  const sessionAllowed = useSessionAccess(sessionId ?? '', 'workspaceFiles/list') === true;
  const canList = sessionId ? sessionAllowed : true;
  const listingState = useResource(canList ? address({ action: 'files', workspaceId, ...(sessionId === undefined ? {} : { sessionId }), path }, generation) : '');
  const previewState = useResource(file ? address({ action: 'file-preview', workspaceId, ...(sessionId === undefined ? {} : { sessionId }), path: file.path }, generation) : '');
  const listing = listingState.value?.ok ? listingState.value.value : undefined;
  const preview = previewState.value?.ok ? previewState.value.value : undefined;
  const fileItem = (entryPath, name) => ({ type: 'file', workspaceId, ...(sessionId === undefined ? {} : { sessionId }), path: entryPath, name });
  return h(React.Fragment, null,
    h('p', { className: 'dsrp-note', style: { padding: '4px 16px' } }, t('fallbackFiles')),
    h('div', { className: 'dsrp-breadcrumb' },
      h('button', { type: 'button', disabled: !path, onClick: () => { setPath(path.split('/').slice(0, -1).join('/')); setFile(null); } }, t('up')),
      h('code', { title: path }, path || t('root')), h('button', { type: 'button', onClick: () => setGeneration(generation + 1) }, t('refresh'))),
    !canList ? h('p', { className: 'dsrp-empty' }, t('unavailable')) : h('div', { className: 'dsrp-file-layout' },
      h('div', { className: 'dsrp-list' }, h(Notice, { state: listingState, t }),
        listing && renderFactorySlot('sidebar.files.tree', {
          root: path, entries: listing.entries.map(entry => ({ path: [path, entry.name].filter(Boolean).join('/'), name: entry.name, meta: { kind: entry.type, ...(entry.size === undefined ? {} : { size: entry.size }) } })),
          expanded: [], current: file?.path,
          directories: listing.truncated ? { [path]: { truncated: true } } : {},
          onToggle: entry => { setPath(entry.path); setFile(null); },
          onOpen: entry => setFile(fileItem(entry.path, entry.name)),
        }, { fallback: h(FallbackFileList, { listing, path, file, workspaceId, sessionId, selected, onToggle, setPath, setFile, t }) }),
        listing && !listing.entries.length && h('p', { className: 'dsrp-empty' }, t('emptyFiles'))),
      h('div', { className: 'dsrp-file-text' }, file && h(React.Fragment, null,
        h('label', { className: 'dsrp-row' }, h('input', { type: 'checkbox', checked: selected.some(item => resourceKey(item) === resourceKey(file)), onChange: () => onToggle(file) }), t('select', { name: file.name })),
        h(Notice, { state: previewState, t })), preview && h(React.Fragment, null, h('pre', { className: 'dsrp-file-text' }, preview.text), preview.truncated && h('p', { className: 'dsrp-note' }, t('truncatedPreview'))))));
}
function FallbackFileList({ listing, path, file, workspaceId, sessionId, selected, onToggle, setPath, setFile, t }) {
  return h(React.Fragment, null, ...listing.entries.map(entry => {
    const entryPath = [path, entry.name].filter(Boolean).join('/');
    if (entry.type === 'other') return null;
    const item = { type: 'file', workspaceId, ...(sessionId === undefined ? {} : { sessionId }), path: entryPath, name: entry.name };
    return h(ResourceRow, { key: entryPath, item, detail: t(entry.type === 'directory' ? 'folder' : 'file'), active: file?.path === entryPath,
      selectable: entry.type === 'file', selected: selected.some(row => resourceKey(row) === resourceKey(item)), onToggle,
      onBrowse: () => { if (entry.type === 'directory') { setPath(entryPath); setFile(null); } else setFile(item); }, t });
  }), listing.truncated && h('p', { className: 'dsrp-note' }, t('truncatedFiles')));
}
function ModelFields({ catalog, selection, setSelection, t }) {
  const models = catalog.groups.flatMap(group => group.models.map(model => ({ group, model })));
  const current = models.find(row => row.group.id === selection?.provider && row.model.id === selection?.model);
  return h(React.Fragment, null, h('div', { className: 'dsrp-models' },
    h('label', { className: 'dsrp-field' }, t('model'), h('select', { value: current ? JSON.stringify([selection.provider, selection.model]) : '', onChange: event => { const [provider, model] = JSON.parse(event.target.value); setSelection({ provider, model }); } },
      !current && h('option', { value: '', disabled: true }, t('model')),
      ...catalog.groups.map(group => h('optgroup', { label: group.name, key: group.id }, ...group.models.map(model => h('option', { key: model.id, value: JSON.stringify([group.id, model.id]) }, model.name)))))),
    h('label', { className: 'dsrp-field' }, t('effort'), h('select', { value: selection?.reasoningEffort ?? '', disabled: !current?.model.reasoning?.efforts.length, onChange: event => setSelection({ provider: selection.provider, model: selection.model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) }) },
      h('option', { value: '' }, t('defaultEffort')), ...current?.model.reasoning?.efforts.map(effort => h('option', { key: effort.id, value: effort.id }, effort.name)) ?? []))),
    catalog.failures?.length > 0 && h('p', { className: 'dsrp-note' }, t('modelFailures')));
}
function FacetRow({ item, useWorkspaceAccess, useSessionAccess, ...props }) {
  const workspaceAllowed = useWorkspaceAccess(item.workspaceId, 'workspace/follow') === true;
  const sessionAllowed = useSessionAccess(item.type === 'session' ? item.sessionId : '', 'session/list') === true;
  return workspaceAllowed && (item.type !== 'session' || sessionAllowed) ? h(ResourceRow, { ...props, item }) : null;
}
function Dialog(props) {
  const { request, t, useWorkspaces, useSessions, useResource, useSessionAccess, useWorkspaceAccess, useRemoteAccess, runOperation, accept, cancel } = props;
  const options = request.options;
  const workspacesState = useWorkspaces(state => state);
  const sessionsState = useSessions(state => state);
  const workspaces = workspacesState.items ?? [];
  const defaultWorkspace = options.workspaceId ?? (options.sessionId ? workspaces.find(ws => ws.sessionIds.includes(options.sessionId))?.workspaceId : workspaces[0]?.workspaceId);
  const [browsing, setBrowsing] = React.useState({ workspaceId: defaultWorkspace, sessionId: options.sessionId });
  const [selection, setSelection] = React.useState(options.initialSelection);
  const [model, setModel] = React.useState(options.modelSelection);
  const [workspaceFilter, setWorkspaceFilter] = React.useState('');
  const [sessionFilter, setSessionFilter] = React.useState('');
  const [mode, setMode] = React.useState(options.allowedTypes.length === 1 && options.allowedTypes[0] === 'file' ? 'files' : 'preview');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [pendingAction, setPendingAction] = React.useState(null);
  const busy = pendingAction !== null;
  const alive = React.useRef(true);
  const operation = React.useRef(null);
  const workspaceId = browsing.workspaceId ?? defaultWorkspace;
  const workspace = workspaces.find(row => row.workspaceId === workspaceId);
  const sessionId = workspace?.sessionIds.includes(browsing.sessionId) ? browsing.sessionId : undefined;
  const canCreateGlobal = useRemoteAccess('session/create') === true;
  const canCreateWorkspace = useWorkspaceAccess(workspaceId, 'session/create') === true;
  const canPreview = useSessionAccess(sessionId ?? '', 'session/events') === true;
  const modelState = useResource(options.selectModel ? address({ action: 'models' }) : '');
  const catalog = modelState.value?.ok ? modelState.value.value : undefined;
  const effectiveModel = model ?? catalog?.default;
  const singleSession = !options.multiple && options.allowedTypes.length === 1 && options.allowedTypes[0] === 'session';
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current?.abort(); };
  }, []);
  const doToggle = item => {
    try { setSelection(toggleSelection(selection, item, options)); setError(''); } catch (reason) { setError(t('selectionError', { message: reason.message })); }
  };
  const browseSession = item => {
    setBrowsing({ workspaceId: item.workspaceId, sessionId: item.sessionId });
    if (singleSession && !selection.some(entry => resourceKey(entry) === resourceKey(item))) doToggle(item);
  };
  const invoke = async (action, callback) => {
    if (operation.current !== null) return;
    const controller = new AbortController(); operation.current = controller; setPendingAction(action); setError('');
    try { await callback(controller.signal); } catch (reason) { if (alive.current) setError(t('operationError', { message: reason.message })); }
    finally { if (operation.current === controller) operation.current = null; if (alive.current) setPendingAction(null); }
  };
  const create = () => invoke('create', async signal => {
    const item = await runOperation({ action: 'create-session', workspaceId, ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }) }, signal);
    if (!alive.current) return;
    setNotice(t('created'));
    browseSession(item);
  });
  const choose = () => invoke('choose', async signal => {
    const result = await runOperation({ action: 'validate', options, items: selection, ...(options.selectModel && effectiveModel ? { modelSelection: effectiveModel } : {}) }, signal);
    if (alive.current) accept(request.id, result.items, result.modelSelection);
  });
  const rows = workspace?.sessionIds.map(id => sessionsState.byId?.[id]).filter(row => row && row.origin !== 'subagent' && (!sessionFilter || `${row.displayTitle ?? row.title ?? ''} ${row.id}`.toLowerCase().includes(sessionFilter.toLowerCase()))) ?? [];
  return h(React.Fragment, null, h('style', null, css),
    h(Modal, { open: true, headless: true, className: 'dsrp-dialog', title: options.title ?? t('title'), shortcutModal: 'resource-picker', onClose: () => cancel(request.id), backdropBlur: false },
      h('header', { className: 'dsrp-header' }, h('div', null, h('h2', { className: 'dsrp-title' }, options.title ?? t('title')), h('p', { className: 'dsrp-caption' }, t('readOnly'))), h('button', { type: 'button', className: 'dsrp-icon-button', 'aria-label': t('close'), onClick: () => cancel(request.id) }, '×')),
      h('div', { className: 'dsrp-body' },
        h('section', { className: 'dsrp-column', 'aria-label': t('workspaces') }, h('div', { className: 'dsrp-column-head' }, h('h3', null, t('workspaces')), h('label', { className: 'dsrp-field' }, t('searchWorkspaces'), h('input', { 'data-modal-autofocus': true, value: workspaceFilter, onChange: event => setWorkspaceFilter(event.target.value) }))),
          h('div', { className: 'dsrp-list' }, workspacesState.phase !== 'ready' && h('p', { className: 'dsrp-note' }, t('loadingCatalog')),
            ...workspaces.filter(ws => `${ws.title} ${ws.path} ${ws.workspaceId}`.toLowerCase().includes(workspaceFilter.toLowerCase())).map(ws => { const item = { type: 'workspace', workspaceId: ws.workspaceId, title: ws.title, path: ws.path }; return h(FacetRow, { key: ws.workspaceId, item, useWorkspaceAccess, useSessionAccess, detail: ws.path, active: ws.workspaceId === workspaceId, selectable: options.allowedTypes.includes('workspace'), selected: selection.some(entry => resourceKey(entry) === resourceKey(item)), onBrowse: () => { setBrowsing({ workspaceId: ws.workspaceId }); setError(''); if (options.allowedTypes.includes('file')) setMode('files'); }, onToggle: doToggle, t }); }),
            !workspaces.length && workspacesState.phase === 'ready' && h('p', { className: 'dsrp-empty' }, t('noWorkspaces')))),
        h('section', { className: 'dsrp-column', 'aria-label': t('sessions') }, h('div', { className: 'dsrp-column-head' }, h('div', { className: 'dsrp-column-top' }, h('h3', null, t('sessions')), options.allowCreateSession && options.allowedTypes.some(type => type !== 'workspace') && canCreateGlobal && canCreateWorkspace && h('button', { type: 'button', disabled: busy || !workspaceId, title: t('createHint'), onClick: create }, t(pendingAction === 'create' ? 'creating' : 'newSession'))), h('label', { className: 'dsrp-field' }, t('searchSessions'), h('input', { value: sessionFilter, onChange: event => setSessionFilter(event.target.value) })), options.allowCreateSession && h('p', { className: 'dsrp-note' }, t('createHint'))),
          h('div', { className: 'dsrp-list' }, !workspace ? h('p', { className: 'dsrp-empty' }, t('chooseWorkspace')) : rows.length ? rows.map(row => {
            const item = { type: 'session', workspaceId, sessionId: row.id, title: row.displayTitle ?? row.title ?? row.id };
            return h(FacetRow, { key: row.id, item, useWorkspaceAccess, useSessionAccess, detail: row.id, active: row.id === sessionId, selectable: options.allowedTypes.includes('session'), selected: selection.some(entry => resourceKey(entry) === resourceKey(item)), onBrowse: () => browseSession(item), onToggle: doToggle, t });
          }) : h('p', { className: 'dsrp-empty' }, t(sessionsState.phase === 'ready' ? 'noSessions' : 'loadingSessions')))),
        h('section', { className: 'dsrp-column', 'aria-label': t('preview') }, h('div', { className: 'dsrp-tabs', role: 'tablist', 'aria-label': t('preview') }, h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'preview', onClick: () => setMode('preview') }, t('preview')), options.allowedTypes.includes('file') && h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'files', onClick: () => setMode('files') }, t('files'))),
          !workspaceId ? h('p', { className: 'dsrp-empty' }, t('chooseWorkspace')) : mode === 'files' ? h(Files, { key: `${workspaceId}:${sessionId ?? ''}`, workspaceId, sessionId, selected: selection, onToggle: doToggle, useResource, useSessionAccess, renderFactorySlot: props.renderFactorySlot, t }) : !sessionId ? h('p', { className: 'dsrp-empty' }, t('chooseSession')) : canPreview ? h(Preview, { key: sessionId, workspaceId, sessionId, useResource, renderFactorySlot: props.renderFactorySlot, t }) : h('p', { className: 'dsrp-empty' }, t('unavailable')))),
      notice && h('p', { className: 'dsrp-note', role: 'status', style: { padding: '8px 16px' } }, notice),
      error && h('div', { className: 'dsrp-error', role: 'alert' }, error),
      h('footer', { className: 'dsrp-footer' }, h('div', { className: 'dsrp-footer-left' },
        h('div', { className: 'dsrp-selection', 'aria-label': t('selected', { n: selection.length }) }, h('span', { className: 'dsrp-caption' }, t('selected', { n: selection.length })), ...selection.map(item => h('button', { type: 'button', key: resourceKey(item), 'aria-label': t('remove', { name: labelOf(item) }), title: labelOf(item), onClick: () => doToggle(item) }, `${t(item.type)}: ${labelOf(item)} ×`))),
        options.selectModel && (catalog ? h(React.Fragment, null, h(ModelFields, { catalog, selection: effectiveModel, setSelection: setModel, t }), h('p', { className: 'dsrp-note' }, t('modelHint'))) : h(Notice, { state: modelState, t }))),
        h('div', { className: 'dsrp-actions' }, h('button', { type: 'button', onClick: () => cancel(request.id) }, t('cancel')), h('button', { type: 'button', className: 'dsrp-primary', disabled: busy || !selection.length || options.selectModel && (!catalog || !effectiveModel), onClick: choose }, t('choose'))))));
}
function Overlay(props) {
  const request = props.usePickerRequest(value => value);
  return request ? h(Dialog, { ...props, request, key: request.id }) : null;
}
function Launcher({ t, openPicker }) {
  const [result, setResult] = React.useState(null);
  return h('section', { style: { padding: '24px', display: 'grid', gap: '16px' } },
    h('h2', null, t('title')), h('p', null, t('launcherHint')),
    h('button', { type: 'button', onClick: () => { void openPicker().then(value => setResult(value)); } }, t('openPicker')),
    result && h('pre', { style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(result, null, 2)));
}
export const inject = ['slots', 'locale', 'remote', 'workspaces', 'sessions', 'resources', 'remoteAccess'];
export async function apply(ctx) {
  await ctx.remote.$mount(clientContribution(z));
  ctx.inject(['remote.resourcePicker'], inner => {
    const remote = inner['remote.resourcePicker'];
    const runOperation = async (request, signal) => {
      const result = await remote.execute(request, signal);
      if (!result.ok) throw result.error;
      if (!result.value.ok) throw Object.assign(new Error(result.value.error.message), { code: result.value.error.code });
      return result.value.value;
    };
    const queue = new PickerQueue(() => ({ nativeChatPreview: inner.slots.snapshot('factory:conversation.preview').some(node => node.type === 'factory' && node.name === 'conversation.preview'), nativeFilePicker: false, workspaceFiles: inner.get('remote.workspaceFiles') !== undefined, createSession: inner.get('remote.session') !== undefined }));
    inner.provide('resourcePicker', Object.freeze({ version: 1, open: (options, exec) => queue.open(options, exec), capabilities: () => queue.capabilities() }));
    inner.effect(() => () => queue.dispose(), 'resource-picker: requests');
    const uiCopy = dictionary => Object.fromEntries(Object.entries(dictionary).filter(([, value]) => typeof value === 'string'));
    inner.effect(() => inner.locale.register(NS, { en: uiCopy(en), zh: uiCopy(zh) }), 'resource-picker: dictionaries');
    inner.effect(() => inner.resources.register({ protocol: PROTOCOL, async *open(url, { signal }) {
      let request;
      try { request = JSON.parse(decodeURIComponent(new URL(url).pathname.slice(1))); }
      catch (error) { yield { ok: true, value: { ok: false, error: { code: 'invalid-address', message: error.message } } }; return; }
      const result = await remote.execute(request, signal);
      if (!signal.aborted) yield result;
    } }), 'resource-picker: passive resources');
    inner.slots.inject('settings.section', () => inner.slots.register({
      name: 'settings.section', id: 'local.resource-picker', order: 85, locale: NS,
      label: () => inner.locale.bind(NS)('title'),
      inject: () => ({ openPicker: () => queue.open({ allowedTypes: ['workspace', 'session', 'file'], multiple: true, allowParentChild: true, allowCreateSession: true, selectModel: true }) }),
    }, Launcher));
    inner.slots.inject('shell.overlay', function* () {
      yield inner.effect(() => { queue.setAvailable(true); return () => queue.setAvailable(false); }, 'resource-picker: overlay availability');
      yield inner.slots.register({ name: 'shell.overlay', id: 'local.resource-picker', order: 100, locale: NS,
        inject: () => ({ hooks: { pickerRequest: queue }, runOperation, accept: (id, items, model) => queue.select(id, items, model), cancel: id => queue.cancel(id) }),
      }, Overlay);
    });
  });
}
