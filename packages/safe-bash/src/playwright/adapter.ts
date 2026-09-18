import { PlaywrightResourceLimitError } from './resource-limit.js';
import { canonicalPlaywrightDevices } from './devices.js';
import { bindPlaywrightStorageContext } from './native-storage-replacement.js';
import type { FrameSnapshotCapsule, FrameSnapshotInput } from './frame-snapshot.js';

export type BrowserEngine = "chromium" | "firefox" | "webkit";

export type PlaywrightMouseButton = 'left' | 'right' | 'middle';
export type PlaywrightModifier = 'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift';
export interface PlaywrightActionOptions { timeout?: number; button?: PlaywrightMouseButton; modifiers?: PlaywrightModifier[] }
export interface PlaywrightElementActions {
  dblclick?(options?: PlaywrightActionOptions): Promise<void>;
  hover?(options?: { timeout?: number }): Promise<void>;
  check?(options?: { timeout?: number }): Promise<void>;
  uncheck?(options?: { timeout?: number }): Promise<void>;
  selectOption?(values: string | string[], options?: { timeout?: number }): Promise<string[]>;
  press?(key: string, options?: { timeout?: number }): Promise<void>;
  boundingBox?(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  screenshot?(options?: { type?: 'png' | 'jpeg'; quality?: number; timeout?: number; scale?: 'css' | 'device' }): Promise<Uint8Array>;
}

export interface PlaywrightLocator extends PlaywrightElementActions {
  normalize?(): Promise<PlaywrightLocator>;
  _resolveSelector?(): Promise<{ resolvedSelector: string }>;
  highlight?(options?: { style?: string }): Promise<unknown>;
  hideHighlight?(): Promise<void>;
  elementHandle?(options?: { timeout?: number }): Promise<PlaywrightElementHandle | null>;
  count?(): Promise<number>;
  click(options?: PlaywrightActionOptions): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
}

export interface SnapshotContentNode {
  readonly textContent: string | null;
  readonly nodeType?: number;
  readonly tagName?: string;
  readonly firstChild?: SnapshotContentNode | null;
  readonly nextSibling?: SnapshotContentNode | null;
  readonly parentElement?: SnapshotNode | null;
  readonly ownerDocument?: {
    readonly defaultView: {
      readonly document: unknown;
      getComputedStyle?(node: SnapshotContentNode): { readonly display: string; readonly visibility: string; readonly contentVisibility?: string };
    } | null;
    getElementById?(id: string): SnapshotContentNode | null;
  } | null;
  getAttribute?(name: string): string | null;
}

export interface SnapshotNode extends SnapshotContentNode {
  readonly tagName: string;
  readonly innerText?: string;
  readonly isConnected: boolean;
  readonly labels?: ArrayLike<SnapshotContentNode> | null;
  readonly value?: string;
  readonly checked?: boolean;
  readonly indeterminate?: boolean;
  readonly disabled?: boolean;
  readonly multiple?: boolean;
  readonly size?: number;
  getAttribute(name: string): string | null;
}
export interface PlaywrightElementHandle extends PlaywrightElementActions {
  evaluate<T, Argument = undefined>(callback: (node: SnapshotNode, argument: Argument) => T, argument?: Argument): Promise<T>;
  click(options?: PlaywrightActionOptions): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  dispose(): Promise<void>;
  ariaSnapshot?(options?: { timeout?: number }): Promise<string>;
}
export interface PlaywrightFrame {
  url?(): string;
  evaluate?<Result, Argument>(callback: (argument: Argument) => Result, argument: Argument): Promise<Result>;
  evaluateHandle?(callback: (input: FrameSnapshotInput) => FrameSnapshotCapsule, input: FrameSnapshotInput): Promise<PlaywrightSnapshotHandle>;
  locator(selector: string): {
    elementHandles?: () => Promise<PlaywrightElementHandle[]>;
    evaluate?: (callback: (node: SnapshotNode) => string) => Promise<string>;
  };
}

export interface PlaywrightSnapshotHandle {
  evaluate<Result, Arg>(callback: (capsule: FrameSnapshotCapsule, arg: Arg) => Result, arg: Arg): Promise<Result>;
  evaluateHandle(callback: (capsule: FrameSnapshotCapsule, slot: number) => SnapshotNode | undefined, slot: number): Promise<{
    asElement(): PlaywrightElementHandle | null;
    dispose(): Promise<void>;
  }>;
  dispose(): Promise<void>;
}

export interface PlaywrightPage {
  ariaSnapshotJSON?(options?: { mode?: 'ai'; timeout?: number; depth?: number; boxes?: boolean }): Promise<readonly PlaywrightSnapshotJSONNode[]>;
  readonly screencast?: {
    showActions(options?: { duration?: number; position?: 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right'; cursor?: 'none' | 'pointer' }): Promise<unknown>;
    hideActions(): Promise<void>;
  };
  ariaSnapshot?(options?: { mode?: 'ai'; timeout?: number; depth?: number; boxes?: boolean }): Promise<string>;
  _snapshotForAI?(options?: { track?: string; timeout?: number }): Promise<{ full: string; incremental?: string }>;
  mainFrame?(): PlaywrightFrame;
  frames?(): PlaywrightFrame[];
  evaluate?<Result, Argument>(callback: (argument: Argument) => Result, argument: Argument): Promise<Result>;
  on?(event: 'framenavigated' | 'close', listener: () => void): unknown;
  off?(event: 'framenavigated' | 'close', listener: () => void): unknown;
  on?(event: 'filechooser', listener: (chooser: PlaywrightFileChooser) => void): unknown;
  off?(event: 'filechooser', listener: (chooser: PlaywrightFileChooser) => void): unknown;
  on?(event: 'download', listener: (download: PlaywrightDownload) => void): unknown;
  off?(event: 'download', listener: (download: PlaywrightDownload) => void): unknown;
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  goBack?(options?: { timeout?: number }): Promise<unknown>;
  goForward?(options?: { timeout?: number }): Promise<unknown>;
  reload?(options?: { timeout?: number }): Promise<unknown>;
  title?(): Promise<string>;
  hideHighlight?(): Promise<void>;
  waitForTimeout?(milliseconds: number): Promise<void>;
  setViewportSize?(size: { width: number; height: number }): Promise<void>;
  pdf?(options?: { format?: string; printBackground?: boolean }): Promise<Uint8Array>;
  url(): string;
  locator(selector: string): PlaywrightLocator;
  readonly keyboard: { press(key: string): Promise<void>; insertText?(text: string): Promise<void>; type?(text: string): Promise<void>; down?(key: string): Promise<void>; up?(key: string): Promise<void> };
  readonly mouse?: { move(x: number, y: number): Promise<void>; down(options?: { button?: PlaywrightMouseButton }): Promise<void>; up(options?: { button?: PlaywrightMouseButton }): Promise<void>; wheel(deltaX: number, deltaY: number): Promise<void> };
  screenshot(options?: { type?: "png" | "jpeg"; quality?: number; fullPage?: boolean; timeout?: number; scale?: 'css' | 'device'; clip?: { x: number; y: number; width: number; height: number } }): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface PlaywrightCookie {
  name: string; value: string; domain: string; path: string;
  expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None'; partitionKey?: string;
}
export interface PlaywrightStorageState {
  cookies: (PlaywrightCookie & { expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' })[];
  origins: { origin: string; localStorage: { name: string; value: string }[]; indexedDB?: PlaywrightIndexedDBDatabase[] }[];
}
export interface PlaywrightIndexedDBDatabase {
  name: string; version: number;
  stores: {
    name: string; autoIncrement: boolean; keyPath?: string; keyPathArray?: string[];
    records: { key?: unknown; keyEncoded?: unknown; value?: unknown; valueEncoded?: unknown }[];
    indexes: { name: string; keyPath?: string; keyPathArray?: string[]; multiEntry: boolean; unique: boolean }[];
  }[];
}

export interface PlaywrightContext {
  newCDPSession?(page: PlaywrightPage): Promise<import('./native-storage-replacement.js').PlaywrightStorageIdentityCDP>;
  addInitScript?(script: string | { content: string }): Promise<unknown>;
  _startRecording?(options: { language: string }, sink: PlaywrightRecorderSink): Promise<void>;
  _stopRecording?(): Promise<void>;
  _enableRecorder?(options: { language: string; mode: 'recording'; recorderMode: 'api' }, sink: PlaywrightRecorderSink): Promise<void>;
  _disableRecorder?(): Promise<void>;
  readonly tracing?: {
    start(options?: { name?: string; screenshots?: boolean; snapshots?: boolean; sources?: boolean; live?: boolean; _live?: boolean }): Promise<void>;
    stop(options?: { path?: string }): Promise<void>;
  };
  cookies?(): Promise<PlaywrightCookie[]>;
  addCookies?(cookies: PlaywrightCookie[]): Promise<void>;
  clearCookies?(options?: { name?: string; domain?: string; path?: string }): Promise<void>;
  storageState?(options?: { indexedDB?: boolean }): Promise<PlaywrightStorageState>;
  setStorageState?(state: PlaywrightStorageState): Promise<void>;
  setOffline?(offline: boolean): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  pages(): PlaywrightPage[];
  close(): Promise<void>;
  on(event: "close" | "page", listener: () => void): unknown;
  off(event: "close" | "page", listener: () => void): unknown;
  on(event: 'page', listener: (page: PlaywrightPage) => void): unknown;
  off(event: 'page', listener: (page: PlaywrightPage) => void): unknown;
  on(event: 'dialog', listener: (dialog: PlaywrightDialog) => void): unknown;
  off(event: 'dialog', listener: (dialog: PlaywrightDialog) => void): unknown;
  on(event: 'request', listener: (request: PlaywrightNetworkRequest) => void): unknown;
  off(event: 'request', listener: (request: PlaywrightNetworkRequest) => void): unknown;
  on(event: 'response', listener: (response: PlaywrightNetworkResponse) => void): unknown;
  off(event: 'response', listener: (response: PlaywrightNetworkResponse) => void): unknown;
  on(event: 'console', listener: (message: PlaywrightConsoleMessage) => void): unknown;
  off(event: 'console', listener: (message: PlaywrightConsoleMessage) => void): unknown;
}

export interface PlaywrightRecorderSink {
  actionAdded(page: PlaywrightPage, action: unknown, code: string): void;
  actionUpdated(page: PlaywrightPage, action: unknown, code: string): void;
  signalAdded(page: PlaywrightPage, signal: unknown, code?: string): void;
}

export interface PlaywrightDialog {
  page(): PlaywrightPage | null;
  type(): string;
  message(): string;
  defaultValue(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

export interface PlaywrightFileChooser {
  isMultiple(): boolean;
  setFiles(files: string | readonly string[] | { name: string; mimeType: string; buffer: Uint8Array } | readonly { name: string; mimeType: string; buffer: Uint8Array }[], options?: { timeout?: number }): Promise<void>;
}

export interface PlaywrightDownload {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
  cancel(): Promise<void>;
  delete(): Promise<void>;
}

export interface PlaywrightNetworkRequest {
  url(): string;
  method(): string;
  resourceType(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  failure(): { errorText: string } | null;
  frame(): { page(): PlaywrightPage; parentFrame(): unknown | null };
  isNavigationRequest(): boolean;
  timing?(): { responseEnd: number };
}
export interface PlaywrightNetworkResponse {
  request(): PlaywrightNetworkRequest;
  status(): number;
  statusText(): string;
  headers(): Record<string, string>;
  body(): Promise<Uint8Array>;
}
export interface PlaywrightConsoleMessage {
  type(): string;
  text(): string;
  location(): { url: string; lineNumber: number; columnNumber: number };
  page(): PlaywrightPage | null;
}

export interface PlaywrightBrowser {
  isConnected(): boolean;
  newContext(options?: PlaywrightContextOptions): Promise<PlaywrightContext>;
  on(event: "disconnected", listener: () => void): unknown;
  off(event: "disconnected", listener: () => void): unknown;
}

export interface PlaywrightContextOptions {
  storageState?: PlaywrightStorageState;
  userAgent?: string;
  viewport?: { width: number; height: number } | null;
  screen?: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  locale?: string;
  timezoneId?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference' | null;
  reducedMotion?: 'reduce' | 'no-preference' | null;
  forcedColors?: 'active' | 'none' | null;
  javaScriptEnabled?: boolean;
  ignoreHTTPSErrors?: boolean;
  acceptDownloads?: boolean;
  permissions?: string[];
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  extraHTTPHeaders?: Record<string, string>;
  baseURL?: string;
  offline?: boolean;
  strictSelectors?: boolean;
  bypassCSP?: boolean;
  httpCredentials?: { username: string; password: string; origin?: string; send?: 'unauthorized' | 'always' };
  serviceWorkers?: 'allow' | 'block';
}

export interface PlaywrightDeviceDescriptor {
  userAgent: string;
  viewport: { width: number; height: number };
  screen?: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  defaultBrowserType: BrowserEngine;
}

export interface PlaywrightAcquireOptions {
  readonly acquisitionId: string;
  readonly session: string;
  readonly browser: BrowserEngine;
  readonly headless: boolean;
  readonly signal: AbortSignal;
  readonly contextOptions?: PlaywrightContextOptions;
}

export interface PlaywrightBrowserSource {
  readonly headed?: boolean;
  // Trusted host callback. Owns cleanup of partial acquisition before return.
  // release terminates an owned browser, detaches an owned connection, or
  // returns a pool resource. It must never terminate a borrowed browser.
  acquireBrowser(options: PlaywrightAcquireOptions): Promise<{
    readonly browser: PlaywrightBrowser;
    readonly prepareStorageOrigin?: import('./native-storage-replacement.js').PlaywrightStorageOriginPreparer;
    readonly captureArtifact?: PlaywrightArtifactCapture;
    readonly captureDownload?: PlaywrightDownloadCapture;
    readonly captureTrace?: PlaywrightTraceCapture;
    readonly executeCode?: PlaywrightCodeExecutor;
    readonly generateActionCode?: PlaywrightActionCodeGenerator;
    readonly captureSnapshotJSON?: PlaywrightSnapshotJSONCapture;
    /** Return an owned native-compatible byte buffer with identical contents. */
    readonly prepareFileBytes?: (bytes: Uint8Array) => Uint8Array;
    interrupt?(): Promise<void>;
    release(): Promise<void>;
  }>;
}

export interface PlaywrightArtifactCaptureOptions {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly extension: string;
}
/** The trusted host owns a fresh private temporary pathname, bounded byte reads,
 * and cleanup after the fully settled producer, including failure/cancellation. */
export type PlaywrightArtifactCapture = (produce: (temporaryPath: string) => Promise<void>, options: PlaywrightArtifactCaptureOptions) => Promise<Uint8Array>;
/** Provider-supported retrieval of the original native download, never a replay. */
export type PlaywrightDownloadCapture = (download: PlaywrightDownload, options: { readonly signal: AbortSignal; readonly maxBytes: number }) => Promise<Uint8Array>;
/** Flush and read bounded original native trace files, including after stop. */
export type PlaywrightTraceCapture = (context: PlaywrightContext, options: { readonly signal: AbortSignal; readonly maxBytes: number }) => Promise<{ readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[] }>;

export interface PlaywrightCodeExecutionOptions {
  readonly page: PlaywrightPage;
  readonly source: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxPages: number;
}
/** Trusted isolated host execution of a function receiving the native page.
 * Must enforce the supplied limits and settle only after owned work is drained. */
export type PlaywrightCodeExecutor = (options: PlaywrightCodeExecutionOptions) => Promise<unknown>;

export type PlaywrightCodegenAction =
  | { readonly name: 'navigate'; readonly url: string }
  | { readonly name: 'click'; readonly selector: string; readonly button: PlaywrightMouseButton; readonly modifiers: number; readonly clickCount: number }
  | { readonly name: 'fill'; readonly selector: string; readonly text: string }
  | { readonly name: 'press'; readonly selector: string; readonly key: string; readonly modifiers: number }
  | { readonly name: 'hover' | 'check' | 'uncheck'; readonly selector: string }
  | { readonly name: 'select'; readonly selector: string; readonly options: readonly string[] };
export type PlaywrightActionCodeGenerator = (request: { readonly language: 'typescript' | 'python' | 'java' | 'csharp'; readonly action: PlaywrightCodegenAction }) => string;

export interface PlaywrightSnapshotJSONNode {
  readonly role: string;
  readonly name?: string;
  readonly text?: string;
  readonly children?: readonly PlaywrightSnapshotJSONNode[];
  readonly checked?: boolean | 'mixed';
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly active?: boolean;
  readonly invalid?: boolean | 'grammar' | 'spelling';
  readonly level?: number;
  readonly pressed?: boolean | 'mixed';
  readonly selected?: boolean;
  readonly ariaHidden?: boolean;
  readonly url?: string;
  readonly placeholder?: string;
  readonly ref?: string;
  readonly cursor?: 'pointer';
  readonly box?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}
export type PlaywrightSnapshotJSONCapture = (page: PlaywrightPage, options: { readonly signal: AbortSignal; readonly timeoutMs: number; readonly maxBytes: number; readonly boxes?: boolean }) => Promise<readonly PlaywrightSnapshotJSONNode[]>;

export interface PlaywrightLease {
  readonly context: PlaywrightContext;
  replaceContext?(state: PlaywrightStorageState, options?: { signal?: AbortSignal }): Promise<PlaywrightContext>;
  readonly captureArtifact?: PlaywrightArtifactCapture;
  readonly captureDownload?: PlaywrightDownloadCapture;
  readonly captureTrace?: PlaywrightTraceCapture;
  readonly executeCode?: PlaywrightCodeExecutor;
  readonly generateActionCode?: PlaywrightActionCodeGenerator;
  readonly captureSnapshotJSON?: PlaywrightSnapshotJSONCapture;
  readonly prepareFileBytes?: (bytes: Uint8Array) => Uint8Array;
  // Context closure, transport loss or local release invalidates the lease;
  // notification is not evidence of remote termination. Listeners must not throw.
  onClosed(listener: () => void): () => void;
  release(): Promise<void>;
}

export interface PlaywrightAdapter {
  readonly browsers: Readonly<Partial<Record<BrowserEngine, { readonly headed: boolean }>>>;
  readonly devices?: Readonly<Record<string, PlaywrightDeviceDescriptor>>;
  acquire(options: PlaywrightAcquireOptions): Promise<PlaywrightLease>;
}

export function createPlaywrightAdapter(sources: Partial<Record<BrowserEngine, PlaywrightBrowserSource>>, options: { devices?: Readonly<Record<string, PlaywrightDeviceDescriptor>> } = {}): PlaywrightAdapter {
  if (!sources || typeof sources !== 'object' || Object.keys(sources).some(engine => !['chromium', 'firefox', 'webkit'].includes(engine))) throw new TypeError('Invalid Playwright browser sources');
  if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'devices') || options.devices !== undefined && (!options.devices || typeof options.devices !== 'object' || Array.isArray(options.devices))) throw new TypeError('Invalid Playwright adapter options');
  const devices = Object.freeze(structuredClone({ ...canonicalPlaywrightDevices, ...options.devices }));
  const configured = new Map<BrowserEngine, PlaywrightBrowserSource>();
  const browsers: Partial<Record<BrowserEngine, { readonly headed: boolean }>> = {};
  for (const engine of ["chromium", "firefox", "webkit"] as const) {
    const source = sources[engine];
    if (source === undefined) continue;
    if (!source || typeof source !== 'object' || typeof source.acquireBrowser !== 'function'
      || source.headed !== undefined && typeof source.headed !== 'boolean'
      || Object.keys(source).some(key => !['headed', 'acquireBrowser'].includes(key))) throw new TypeError('Invalid Playwright browser capability');
    configured.set(engine, { headed: source.headed === true, acquireBrowser: source.acquireBrowser.bind(source) });
    browsers[engine] = Object.freeze({ headed: source.headed === true });
  }
  return {
    browsers: Object.freeze(browsers),
    ...(devices ? { devices } : {}),
    async acquire(options) {
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['acquisitionId', 'session', 'browser', 'headless', 'signal', 'contextOptions'].includes(key))
        || typeof options.headless !== 'boolean' || typeof options.acquisitionId !== 'string' || !options.acquisitionId
        || typeof options.session !== 'string' || !options.session
        || typeof options.signal?.throwIfAborted !== 'function') throw new TypeError('Invalid Playwright acquisition options');
      if (options.contextOptions !== undefined && (!options.contextOptions || typeof options.contextOptions !== 'object' || Array.isArray(options.contextOptions))) throw new TypeError('Invalid Playwright context options');
      const contextOptions = options.contextOptions === undefined ? undefined : structuredClone(options.contextOptions);
      const source = configured.get(options.browser);
      if (!source) throw new Error(`Unsupported browser: ${options.browser}`);
      if (!options.headless && !source.headed) throw new Error(`Headed mode is unsupported for ${options.browser}`);
      options.signal.throwIfAborted();
      // No race against abort: opaque host acquisition must settle so its late
      // resource can be retired. Hosts may cooperatively honor the signal.
      const resource = await source.acquireBrowser(options);
      let context: PlaywrightContext | undefined;
      let closed = false;
      let contextCloseObserved = false;
      let browserDisconnectedObserved = false;
      let releasing: Promise<void> | undefined;
      let replacement: Promise<PlaywrightContext> | undefined;
      let retireStorage: (() => Promise<void>) | undefined;
      const retiringContexts = new Set<PlaywrightContext>();
      const captures = new Set<Promise<unknown>>();
      const executions = new Set<Promise<unknown>>();
      const listeners = new Set<() => void>();
      const detach = () => {
        resource.browser.off("disconnected", onDisconnected);
        context?.off("close", onContextClosed);
      };
      const notify = () => {
        if (closed) return;
        closed = true;
        detach();
        const pending = [...listeners];
        listeners.clear();
        for (const listener of pending) listener();
      };
      const onDisconnected = () => { browserDisconnectedObserved = true; notify(); };
      const onContextClosed = () => { contextCloseObserved = true; notify(); };
      const release = (): Promise<void> => {
        releasing ??= Promise.resolve().then(async () => {
          const errors: unknown[] = [];
          let contextFailure: { error: unknown } | undefined;
          try { browserDisconnectedObserved ||= !resource.browser.isConnected(); }
          catch (error) { errors.push(error); }
          const interruption = Promise.resolve().then(() => resource.interrupt?.()).catch(error => { errors.push(error); });
          try { await retireStorage?.(); } catch (error) { errors.push(error); }
          await replacement?.catch(() => {});
          await Promise.allSettled([...captures]);
          await Promise.allSettled([...executions]);
          for (const retired of retiringContexts) {
            try { await retired.close(); } catch (error) { errors.push(error); }
          }
          retiringContexts.clear();
          if (context) {
            try { await context.close(); notify(); } catch (error) { contextFailure = { error }; }
          }
          await interruption;
          try { await resource.release(); } catch (error) { errors.push(error); }
          try { browserDisconnectedObserved ||= !resource.browser.isConnected(); }
          catch (error) { errors.push(error); }
          if (contextFailure) {
            const error = contextFailure.error;
            const expectedClosure = (contextCloseObserved || browserDisconnectedObserved)
              && error instanceof Error && !(error instanceof AggregateError)
              && ['Error', 'TargetClosedError'].includes(error.name)
              && ['Target page, context or browser has been closed', 'browserContext.close: Target page, context or browser has been closed'].includes(error.message);
            if (!expectedClosure) errors.unshift(error);
          }
          // Retirement invalidates the local lease even if context closure
          // failed or the host merely returned a borrowed browser to its owner.
          // This notification does not establish remote browser termination.
          notify();
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) throw new AggregateError(errors, "Playwright lease release failed");
        });
        return releasing;
      };
      try {
        resource.browser.on("disconnected", onDisconnected);
        options.signal.throwIfAborted();
        if (!resource.browser.isConnected()) onDisconnected();
        if (closed) throw new Error("Playwright browser is closed");
        context = await resource.browser.newContext(contextOptions);
        context.on("close", onContextClosed);
        if (!context.setStorageState && resource.prepareStorageOrigin) retireStorage = await bindPlaywrightStorageContext(context, resource.prepareStorageOrigin, options.signal, contextOptions?.storageState?.origins.map(item => item.origin));
        options.signal.throwIfAborted();
        if (!resource.browser.isConnected()) onDisconnected();
        if (closed) throw new Error("Playwright browser closed during context acquisition");
        return {
          get context() { return context!; },
          ...(resource.captureSnapshotJSON ? { captureSnapshotJSON: ((page, captureOptions) => {
            if (closed || releasing) return Promise.reject(new Error('Playwright lease is closed'));
            captureOptions.signal.throwIfAborted();
            if (!Number.isSafeInteger(captureOptions.maxBytes) || captureOptions.maxBytes < 1) return Promise.reject(new TypeError('Invalid Playwright snapshot capture options'));
            const ownedOptions = Object.freeze({ ...captureOptions });
            const operation = Promise.resolve().then(async () => {
              ownedOptions.signal.throwIfAborted();
              const result = await resource.captureSnapshotJSON!(page, ownedOptions);
              ownedOptions.signal.throwIfAborted();
              return result;
            });
            captures.add(operation);
            void operation.finally(() => captures.delete(operation)).catch(() => {});
            return operation;
          }) as PlaywrightSnapshotJSONCapture } : {}),
          ...(resource.generateActionCode ? { generateActionCode: ((request) => {
            if (closed || releasing) throw new Error('Playwright lease is closed');
            if (!['typescript', 'python', 'java', 'csharp'].includes(request.language)) throw new Error('Invalid Playwright codegen language');
            const result = resource.generateActionCode!(structuredClone(request));
            if (typeof result !== 'string') throw new Error('Invalid generated Playwright action code');
            return result;
          }) as PlaywrightActionCodeGenerator } : {}),
          ...(resource.captureTrace ? { captureTrace: ((traceContext, captureOptions) => {
            if (closed || releasing) return Promise.reject(new Error('Playwright lease is closed'));
            captureOptions.signal.throwIfAborted();
            if (!Number.isSafeInteger(captureOptions.maxBytes) || captureOptions.maxBytes < 1) return Promise.reject(new TypeError('Invalid Playwright trace capture options'));
            const ownedOptions = Object.freeze({ ...captureOptions });
            const operation = Promise.resolve().then(async () => {
              ownedOptions.signal.throwIfAborted();
              const result = await resource.captureTrace!(traceContext, ownedOptions);
              ownedOptions.signal.throwIfAborted();
              return result;
            });
            captures.add(operation);
            void operation.finally(() => captures.delete(operation)).catch(() => {});
            return operation;
          }) as PlaywrightTraceCapture } : {}),
          ...(resource.captureDownload ? { captureDownload: ((download, captureOptions) => {
            if (closed || releasing) return Promise.reject(new Error('Playwright lease is closed'));
            captureOptions.signal.throwIfAborted();
            if (!Number.isSafeInteger(captureOptions.maxBytes) || captureOptions.maxBytes <= 0) return Promise.reject(new TypeError('Invalid Playwright download capture options'));
            const ownedOptions = Object.freeze({ ...captureOptions });
            const operation = Promise.resolve().then(async () => {
              ownedOptions.signal.throwIfAborted();
              const bytes = await resource.captureDownload!(download, ownedOptions);
              ownedOptions.signal.throwIfAborted();
              if (!(bytes instanceof Uint8Array) || bytes.byteLength > ownedOptions.maxBytes) throw new PlaywrightResourceLimitError('Playwright download byte limit exceeded');
              return bytes;
            });
            captures.add(operation);
            void operation.finally(() => captures.delete(operation)).catch(() => {});
            return operation;
          }) as PlaywrightDownloadCapture } : {}),
          ...(resource.executeCode ? { executeCode: (executionOptions: PlaywrightCodeExecutionOptions): Promise<unknown> => {
            if (closed || releasing) return Promise.reject(new Error('Playwright lease is closed'));
            executionOptions.signal.throwIfAborted();
            if (typeof executionOptions.source !== 'string' || !executionOptions.source.trim()
              || ![executionOptions.timeoutMs, executionOptions.maxOutputBytes, executionOptions.maxPages].every(value => Number.isSafeInteger(value) && value > 0)) return Promise.reject(new TypeError('Invalid Playwright code execution options'));
            const ownedOptions = Object.freeze({ ...executionOptions });
            const operation = Promise.resolve().then(async () => {
              ownedOptions.signal.throwIfAborted();
              const result = await resource.executeCode!(ownedOptions);
              ownedOptions.signal.throwIfAborted();
              return result;
            });
            executions.add(operation);
            void operation.finally(() => executions.delete(operation)).catch(() => {});
            return operation;
          } } : {}),
          ...(resource.prepareFileBytes ? { prepareFileBytes: (bytes: Uint8Array): Uint8Array => {
            if (closed || releasing) throw new Error('Playwright lease is closed');
            const prepared = resource.prepareFileBytes!(bytes);
            if (!(prepared instanceof Uint8Array) || prepared.byteLength !== bytes.byteLength) throw new Error('Invalid native Playwright file buffer');
            return prepared;
          } } : {}),
          ...(resource.captureArtifact ? { captureArtifact: (produce: (path: string) => Promise<void>, captureOptions: PlaywrightArtifactCaptureOptions): Promise<Uint8Array> => {
            if (closed || releasing) return Promise.reject(new Error('Playwright lease is closed'));
            captureOptions.signal.throwIfAborted();
            if (!Number.isSafeInteger(captureOptions.maxBytes) || captureOptions.maxBytes <= 0 || !captureOptions.extension || [...captureOptions.extension].some(character => !'abcdefghijklmnopqrstuvwxyz0123456789'.includes(character))) throw new Error('Invalid Playwright artifact capture options');
            const operation = Promise.resolve().then(async () => {
              let active = true, invoked = false, settled = false;
              let pending: Promise<void> | undefined;
              let bytes: Uint8Array | undefined;
              let failure: unknown;
              let failed = false;
              try {
                captureOptions.signal.throwIfAborted();
                bytes = await resource.captureArtifact!(path => {
                  if (!active || invoked) return Promise.reject(new Error('Playwright artifact producer is closed'));
                  if (typeof path !== 'string' || !path || path.includes('\0')) return Promise.reject(new Error('Invalid artifact temporary path'));
                  invoked = true;
                  pending = Promise.resolve().then(() => produce(path)).finally(() => { settled = true; });
                  void pending.catch(() => {});
                  return pending;
                }, captureOptions);
                if (!invoked || !settled) throw new Error('Playwright artifact host acknowledged before producer completion');
              } catch (error) { failure = error; failed = true; }
              active = false;
              try { await pending; } catch (error) { if (!failed) { failure = error; failed = true; } }
              captureOptions.signal.throwIfAborted();
              if (failed) throw failure;
              if (!(bytes instanceof Uint8Array) || bytes.byteLength > captureOptions.maxBytes) throw new PlaywrightResourceLimitError('Playwright artifact capture byte limit exceeded');
              return bytes;
            });
            captures.add(operation);
            void operation.finally(() => captures.delete(operation)).catch(() => {});
            return operation;
          } } : {}),
          replaceContext(state, replaceOptions = {}) {
            if (closed || releasing) return Promise.reject(new Error('Playwright lease is closed'));
            if (replacement) return Promise.reject(new Error('Playwright context replacement is already in progress'));
            const operation = (async () => {
              replaceOptions.signal?.throwIfAborted();
              let fresh: PlaywrightContext | undefined;
              try {
                fresh = await resource.browser.newContext({ ...contextOptions, storageState: state });
                replaceOptions.signal?.throwIfAborted();
                if (closed || releasing || !resource.browser.isConnected()) throw new Error('Playwright lease closed during context replacement');
                const previous = context!;
                previous.off('close', onContextClosed);
                context = fresh;
                fresh = undefined;
                contextCloseObserved = false;
                context.on('close', onContextClosed);
                retiringContexts.add(previous);
                await previous.close();
                retiringContexts.delete(previous);
                replaceOptions.signal?.throwIfAborted();
                return context;
              } catch (error) {
                if (fresh) {
                  try { await fresh.close(); }
                  catch (cleanup) { retiringContexts.add(fresh); throw new AggregateError([error, cleanup], 'Playwright context replacement and cleanup failed'); }
                }
                throw error;
              }
            })();
            replacement = operation;
            void operation.finally(() => { if (replacement === operation) replacement = undefined; }).catch(() => {});
            return operation;
          },
          onClosed(listener) {
            if (closed) { listener(); return () => {}; }
            listeners.add(listener);
            return () => { listeners.delete(listener); };
          },
          release,
        };
      } catch (error) {
        try { await release(); } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Playwright acquisition and cleanup failed");
        } finally { detach(); }
        throw error;
      }
    },
  };
}
