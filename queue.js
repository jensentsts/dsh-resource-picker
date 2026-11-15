import { normalizeOptions, normalizeSelection, modelSelection } from './domain.js';
/** A bounded FIFO of browser-owned requests. No request or resolver survives unload. */
export class PickerQueue {
  version = 1;
  #requests = [];
  #listeners = new Set();
  #next = 0;
  #closed = false;
  #available = false;
  #snapshot = null;
  constructor(capabilities = () => ({})) { this.readCapabilities = capabilities; }
  getSnapshot = () => this.#snapshot;
  subscribe = listener => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  capabilities() { return { ...this.readCapabilities(), overlay: this.#available && !this.#closed }; }
  setAvailable(available) {
    this.#available = available;
    if (!available) for (const request of [...this.#requests]) this.cancel(request.id, 'disposed');
  }
  open(input = {}, exec = {}) {
    let options;
    try { options = normalizeOptions(input); } catch (error) { return Promise.reject(error); }
    if (this.#closed || !this.#available) return Promise.resolve({ status: 'cancelled', reason: 'disposed' });
    if (exec.signal?.aborted) return Promise.resolve({ status: 'cancelled', reason: 'aborted' });
    if (this.#requests.length >= 32) return Promise.reject(new Error('resource-picker queue is full'));
    return new Promise(resolve => {
      const request = { id: ++this.#next, options, resolve, signal: exec.signal };
      request.abort = () => this.cancel(request.id, 'aborted');
      exec.signal?.addEventListener('abort', request.abort, { once: true });
      this.#requests.push(request);
      this.#publish();
    });
  }
  select(id, items, selection) {
    const current = this.#requests[0];
    if (current?.id !== id) return false;
    const normalized = normalizeSelection(items, current.options);
    if (!normalized.length) throw new Error('Select at least one resource');
    const result = { status: 'selected', items: normalized };
    if (current.options.selectModel && selection !== undefined) result.modelSelection = modelSelection(selection);
    this.#settle(current, result);
    return true;
  }
  cancel(id, reason = 'user') {
    const current = this.#requests.find(request => request.id === id);
    if (!current) return false;
    this.#settle(current, { status: 'cancelled', reason });
    return true;
  }
  dispose() {
    this.#closed = true;
    this.setAvailable(false);
    this.#listeners.clear();
  }
  #settle(request, result) {
    request.signal?.removeEventListener('abort', request.abort);
    this.#requests.splice(this.#requests.indexOf(request), 1);
    this.#publish();
    request.resolve(result);
  }
  #publish() {
    const first = this.#requests[0];
    if (this.#snapshot?.id === first?.id) return;
    this.#snapshot = first ? { id: first.id, options: first.options } : null;
    for (const listener of this.#listeners) {
      try { listener(); } catch (error) { console.error('[resource-picker] request subscriber failed', error); }
    }
  }
}
