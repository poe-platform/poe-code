export type BrowserEngine = "chromium" | "firefox" | "webkit";

// Deliberately excludes native paths, uploads, eval, and private snapshot APIs.
export interface PlaywrightLocator {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
}

export interface SnapshotNode {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly innerText?: string;
  readonly isConnected: boolean;
  readonly ownerDocument?: {
    readonly defaultView: { readonly document: unknown } | null;
    getElementById?(id: string): { readonly textContent: string | null } | null;
  };
  readonly labels?: ArrayLike<{ readonly textContent: string | null }> | null;
  readonly value?: string;
  readonly checked?: boolean;
  readonly indeterminate?: boolean;
  readonly disabled?: boolean;
  readonly multiple?: boolean;
  readonly size?: number;
  getAttribute(name: string): string | null;
}
export interface PlaywrightElementHandle {
  evaluate<T>(callback: (node: SnapshotNode) => T): Promise<T>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  dispose(): Promise<void>;
}
export interface PlaywrightFrame {
  locator(selector: string): {
    elementHandles?: () => Promise<PlaywrightElementHandle[]>;
    evaluate?: (callback: (node: SnapshotNode) => string) => Promise<string>;
  };
}

export interface PlaywrightPage {
  frames?(): PlaywrightFrame[];
  on?(event: 'framenavigated' | 'close', listener: () => void): unknown;
  off?(event: 'framenavigated' | 'close', listener: () => void): unknown;
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  url(): string;
  locator(selector: string): PlaywrightLocator;
  readonly keyboard: { press(key: string): Promise<void> };
  screenshot(options?: { type?: "png" | "jpeg"; fullPage?: boolean; timeout?: number }): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  pages(): PlaywrightPage[];
  close(): Promise<void>;
  on(event: "close" | "page", listener: () => void): unknown;
  off(event: "close" | "page", listener: () => void): unknown;
}

export interface PlaywrightBrowser {
  isConnected(): boolean;
  newContext(): Promise<PlaywrightContext>;
  on(event: "disconnected", listener: () => void): unknown;
  off(event: "disconnected", listener: () => void): unknown;
}

export interface PlaywrightAcquireOptions {
  readonly acquisitionId: string;
  readonly session: string;
  readonly browser: BrowserEngine;
  readonly headless: boolean;
  readonly signal: AbortSignal;
}

export interface PlaywrightBrowserSource {
  readonly headed?: boolean;
  // Trusted host callback. Owns cleanup of partial acquisition before return.
  // release terminates an owned browser, detaches an owned connection, or
  // returns a pool resource. It must never terminate a borrowed browser.
  acquireBrowser(options: PlaywrightAcquireOptions): Promise<{
    readonly browser: PlaywrightBrowser;
    release(): Promise<void>;
  }>;
}

export interface PlaywrightLease {
  readonly context: PlaywrightContext;
  // Context closure, transport loss or local release invalidates the lease;
  // notification is not evidence of remote termination. Listeners must not throw.
  onClosed(listener: () => void): () => void;
  release(): Promise<void>;
}

export interface PlaywrightAdapter {
  readonly browsers: Readonly<Partial<Record<BrowserEngine, { readonly headed: boolean }>>>;
  acquire(options: PlaywrightAcquireOptions): Promise<PlaywrightLease>;
}

export function createPlaywrightAdapter(sources: Partial<Record<BrowserEngine, PlaywrightBrowserSource>>): PlaywrightAdapter {
  if (!sources || typeof sources !== 'object' || Object.keys(sources).some(engine => !['chromium', 'firefox', 'webkit'].includes(engine))) throw new TypeError('Invalid Playwright browser sources');
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
    async acquire(options) {
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['acquisitionId', 'session', 'browser', 'headless', 'signal'].includes(key))
        || typeof options.headless !== 'boolean' || typeof options.acquisitionId !== 'string' || !options.acquisitionId
        || typeof options.session !== 'string' || !options.session
        || typeof options.signal?.throwIfAborted !== 'function') throw new TypeError('Invalid Playwright acquisition options');
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
          if (context) {
            try { await context.close(); notify(); } catch (error) { contextFailure = { error }; }
          }
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
        context = await resource.browser.newContext();
        context.on("close", onContextClosed);
        options.signal.throwIfAborted();
        if (!resource.browser.isConnected()) onDisconnected();
        if (closed) throw new Error("Playwright browser closed during context acquisition");
        return {
          context,
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
