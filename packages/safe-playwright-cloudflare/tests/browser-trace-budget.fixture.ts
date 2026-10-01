import { vi } from "vitest";
import { Buffer } from "node:buffer";
import type { EventEmitter } from "node:events";
import { fs } from "memfs";

type Entry = { name: string; value: string };
type Progress = { race<T>(promise: Promise<T>): Promise<T> };
export const progress: Progress = { race: promise => promise };

/** The pinned provider buffers appends and queues writes before touching fs. */
class RecordingFS {
  readonly retained: (string | Uint8Array)[] = [];
  readonly _buffers = new Map<string, string[]>();
  private work = Promise.resolve();
  private failure?: Error;
  pause: Promise<void> = Promise.resolve();
  mkdir(dir: string) { this.queue(async () => { await fs.promises.mkdir(dir, { recursive: true }); }); }
  writeFile(file: string, content: string | Uint8Array, skipIfExists?: boolean) {
    this._buffers.delete(file);
    this.retained.push(content);
    this.queue(async () => {
      if (!skipIfExists || !fs.existsSync(file)) await fs.promises.writeFile(file, content);
      this.retained.splice(this.retained.indexOf(content), 1);
    });
  }
  appendFile(file: string, text: string, flush: boolean) {
    const buffer = this._buffers.get(file) ?? [];
    this._buffers.set(file, buffer);
    buffer.push(text);
    if (flush) this.flush(file);
  }
  copyFile(from: string, to: string) {
    this.flush(from);
    this.queue(async () => { await fs.promises.copyFile(from, to); });
  }
  zip() { throw new Error("The in-process provider uses LocalUtils.zip, not SerializedFS.zip"); }
  private flush(file: string) {
    const buffer = this._buffers.get(file);
    if (!buffer) return;
    this._buffers.delete(file);
    const content = buffer.join("");
    this.retained.push(content);
    this.queue(async () => {
      await fs.promises.appendFile(file, content);
      this.retained.splice(this.retained.indexOf(content), 1);
    });
  }
  private queue(run: () => Promise<void>) {
    this.work = this.work.then(() => this.pause).then(run).catch(error => { this.failure ??= error; });
  }
  async syncAndGetError() {
    for (const file of this._buffers.keys()) this.flush(file);
    await this.work;
    return this.failure;
  }
}

export class NativeRecorder {
  _fs = new RecordingFS();
  _pendingHarEntries = new Set<object>();
  _harTracer = new FixtureHar(this);
  _state?: {
    tracesDir: string; traceFile: string; networkFile: string; resourcesDir: string;
    traceSha1s: Set<string>; networkSha1s: Set<string>; recording: boolean;
  };
  _allResources = new Set<string>();
  stopped = false;
  constructor(readonly _context: { recorders: NativeRecorder[] }, readonly _precreatedTracesDir: string) {
    _context.recorders.push(this);
  }
  start(options: { name?: string }) {
    if (this._state) throw new Error("Tracing has been already started");
    const root = this._precreatedTracesDir;
    const name = options.name ?? "recording";
    this._state = { tracesDir: root, traceFile: `${root}/${name}.trace`, networkFile: `${root}/${name}.network`, resourcesDir: `${root}/resources`, traceSha1s: new Set(), networkSha1s: new Set(), recording: false };
    this._fs.mkdir(this._state.resourcesDir);
    this._fs.writeFile(this._state.networkFile, "");
  }
  async startChunk(_progress: Progress, _options?: unknown) {
    this._state!.recording = true;
    this._fs.appendFile(this._state!.traceFile, "trace\n", true);
    return { traceName: "recording" };
  }
  _appendResource(name: string, content: Uint8Array) {
    if (this._allResources.has(name)) return;
    this._allResources.add(name);
    this._fs.writeFile(`${this._state!.resourcesDir}/${name}`, content, true);
    this._state!.networkSha1s.add(name);
  }
  group() { this._fs.appendFile(this._state!.traceFile, "group\n", true); }
  groupEnd() {}
  onEntryStarted(entry: object) { this._pendingHarEntries.add(entry); }
  onEntryFinished(entry: object) {
    this._pendingHarEntries.delete(entry);
    this._fs.appendFile(this._state!.networkFile, JSON.stringify(entry) + "\n", true);
  }
  async stopChunk(_progress: Progress | undefined, options: { mode: string }) {
    if (!this._state?.recording) {
      if (options.mode !== "discard") throw new Error("Must start tracing before stopping");
      return {};
    }
    this._state.recording = false;
    this.stopped = true;
    if (options.mode === "discard") return {};
    const copy = `${this._state.tracesDir}/recording-copy.network`;
    this._fs.copyFile(this._state.networkFile, copy);
    const entries = [{ name: "trace.trace", value: this._state.traceFile }, { name: "trace.network", value: copy }, ...[...this._state.networkSha1s].map(name => ({ name: `resources/${name}`, value: `${this._state!.resourcesDir}/${name}` }))];
    const error = await this._fs.syncAndGetError();
    if (error) throw error;
    return { entries };
  }
  async stop() { await this._fs.syncAndGetError(); this._state = undefined; }
  abort() { this.stopped = true; }
  async flush() { this.abort(); await this._fs.syncAndGetError(); }
  async resetForReuse() { await this.stopChunk(undefined, { mode: "discard" }); await this.stop(); }
  async deleteTmpTracesDir() {}
}

class FixtureHar {
  _entrySymbol = Symbol("requestHarEntry");
  _pageEntries = new Map<object, object>();
  _eventListeners: { emitter: EventEmitter; eventName: string; handler: (...args: unknown[]) => void }[] = [];
  constructor(private readonly recorder: NativeRecorder) {}
  _onRequest(request: { entry: object; [key: symbol]: object }) {
    request[this._entrySymbol] = request.entry;
    this.recorder.onEntryStarted(request.entry);
  }
  _onAPIRequest(request: { entry: object; [key: symbol]: object }) { this._onRequest(request); }
  _createPageEntryIfNeeded(page: { title: string; mainFrame(): EventEmitter }) {
    const previous = this._pageEntries.get(page);
    if (previous) return previous;
    const entry = { title: "" };
    page.mainFrame().on("addlifecycle", event => {
      if (event === "load") this._onLoad(page, entry);
      if (event === "domcontentloaded") this._onDOMContentLoaded(page, entry);
    });
    this._pageEntries.set(page, entry);
    return entry;
  }
  _onLoad(page: { title: string }, entry: { title: string }) { entry.title = page.title; }
  _onDOMContentLoaded(page: { title: string }, entry: { title: string }) { entry.title = page.title; }
  stop() {
    for (const listener of this._eventListeners) listener.emitter.removeListener(listener.eventName, listener.handler);
    this._eventListeners.length = 0;
    this._pageEntries.clear();
  }
}

export function providerFixture() {
  const nativeContext = { recorders: [] as NativeRecorder[] };
  const native = new NativeRecorder(nativeContext, "/tmp/playwright-artifacts-shared");
  const localUtils = {
    _guid: "local-utils",
    _stackSessions: new Map<string, { callStacks: unknown[]; file: string; live: boolean; writer: Promise<void> }>(),
    async tracingStarted(options: { tracesDir: string; traceName: string; live: boolean }, _progress = progress) {
      const stacksId = `${options.tracesDir}/${options.traceName}.stacks`;
      this._stackSessions.set(stacksId, { callStacks: [], file: stacksId, live: options.live, writer: Promise.resolve() });
      return { stacksId };
    },
    async addStackToTracingNoReply(options: { callData: unknown }) {
      for (const session of this._stackSessions.values()) {
        session.callStacks.push(options.callData);
        if (session.live) session.writer = session.writer.then(async () => { await fs.promises.writeFile(session.file, JSON.stringify(session.callStacks)); });
      }
    },
    async traceDiscarded({ stacksId }: { stacksId: string }, _progress = progress) { this._stackSessions.delete(stacksId); },
    async zip({ entries, zipFile, stacksId }: { entries: Entry[]; zipFile: string; stacksId?: string; mode: string; includeSources?: boolean }, _progress = progress) {
      // Deliberately unbounded; production uses yazl and retains all ZIP chunks.
      await fs.promises.writeFile(zipFile, Buffer.concat(entries.map(entry => fs.readFileSync(entry.value) as Buffer)));
      if (stacksId) this._stackSessions.delete(stacksId);
    },
  };
  const bridge = { _dispatcherByGuid: new Map([[localUtils._guid, localUtils]]) };
  const connection = {
    localUtils: () => localUtils,
    toImpl: (value: unknown): unknown => value === connection ? bridge : native,
    isRemote: () => false,
  };
  const tracing = {
    _connection: connection,
    _tracesDir: "/tmp/playwright-artifacts-shared",
    _stacksId: undefined as string | undefined,
    _resetStackCounter: vi.fn(),
    async start(options: { name?: string; _live?: boolean } = {}) {
      native.start(options);
      const { traceName } = await native.startChunk(progress);
      this._stacksId = (await localUtils.tracingStarted({ tracesDir: this._tracesDir, traceName, live: !!options._live })).stacksId;
    },
    async stopChunk(options: { path?: string } = {}) {
      const result = await native.stopChunk(progress, { mode: options.path ? "entries" : "discard" });
      if (options.path) await localUtils.zip({ entries: result.entries ?? [], zipFile: options.path, stacksId: this._stacksId, mode: "write" }, progress);
      else if (this._stacksId) await localUtils.traceDiscarded({ stacksId: this._stacksId }, progress);
    },
    async stop(options: { path?: string } = {}) { await this.stopChunk(options); await native.stop(); },
  };
  const context = {
    tracing, on() {}, off() {}, pages: () => [], newCDPSession: async () => ({}),
    async close() { await native.flush(); },
  };
  const browser = { isConnected: () => true, on() {}, off() {}, newContext: async () => context };
  return { browser, context, native, localUtils, recorders: nativeContext.recorders,
    resource: { browser, prepareSnapshots() {}, prepareStorageOrigin() {}, interrupt() {}, release: async () => { await context.close(); } } };
}
