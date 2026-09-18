import type { PlaywrightPrivateTargetCreation } from './private-target-transport.js';
import type { PlaywrightStorageOriginPreparer } from './native-storage-replacement.js';

export interface PlaywrightStorageControlEvent {
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
}

export interface PlaywrightStorageControl {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  subscribe(listener: (event: PlaywrightStorageControlEvent) => void): () => void;
}

export function createPlaywrightStorageOriginPreparer(control: PlaywrightStorageControl, privateTargets: { beginCreation(): PlaywrightPrivateTargetCreation }): PlaywrightStorageOriginPreparer {
  return async ({ browserContextId, origin, signal }) => {
    signal.throwIfAborted();
    if (!browserContextId || new URL(origin).origin !== origin) throw new Error('Invalid native storage target request');
    const url = origin + '/';
    let targetId: string | undefined;
    let sessionId: string | undefined;
    let detached = false;
    let destroyed = false;
    let retirement: Promise<void> | undefined;
    let detachOperation: Promise<void> | undefined;
    let controlFailure: Error | undefined;
    let observing = true;
    let resolveDestroyed!: () => void;
    let rejectRemoved!: (error: unknown) => void;
    let resolveLoaded!: () => void;
    let rejectLoaded!: (error: unknown) => void;
    const removed = new Promise<void>((resolve, reject) => { resolveDestroyed = resolve; rejectRemoved = reject; });
    void removed.catch(() => {});
    const loaded = new Promise<void>((resolve, reject) => { resolveLoaded = resolve; rejectLoaded = reject; });
    void loaded.catch(() => {});
    const pending = new Set<Promise<unknown>>();
    let eventFailure: unknown;
    const unsubscribe = control.subscribe(event => {
      if (event.method === 'Inspector.detached' && event.sessionId === undefined) {
        controlFailure ??= new Error('Native storage control disconnected');
        rejectLoaded(controlFailure);
        rejectRemoved(controlFailure);
        stopObserving();
        return;
      }
      if (event.method === 'Target.targetDestroyed' && targetId && event.params?.targetId === targetId) {
        destroyed = true;
        resolveDestroyed();
        rejectLoaded(new Error('Native storage target closed'));
      }
      if (!sessionId || event.sessionId !== sessionId) return;
      if (event.method === 'Page.loadEventFired') resolveLoaded();
      if (event.method !== 'Fetch.requestPaused') return;
      const operation = Promise.resolve().then(async () => {
        const request = event.params?.request as { url?: unknown } | undefined;
        if (request?.url !== url || event.params?.resourceType !== 'Document' || typeof event.params?.requestId !== 'string') throw new Error('Unexpected private storage navigation');
        await control.send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: btoa('<!doctype html><html><head></head><body></body></html>') }, sessionId);
      });
      pending.add(operation);
      void operation.catch(error => { eventFailure = error; rejectLoaded(error); }).finally(() => pending.delete(operation));
    });
    const detach = (): Promise<void> => detachOperation ??= (async () => {
      if (retirement) { await retirement; detached = true; return; }
      if (controlFailure) throw controlFailure;
      if (sessionId && !detached && !destroyed) await control.send('Target.detachFromTarget', { sessionId });
      detached = true;
    })();
    const release = (): Promise<void> => retirement ??= (async () => {
      try {
        if (controlFailure) throw controlFailure;
        if (targetId && !destroyed) {
          const result = await control.send('Target.closeTarget', { targetId });
          if (controlFailure) throw controlFailure;
          if (result.success !== true && !destroyed) throw new Error('Native storage target retirement rejected');
          await removed;
        }
        await Promise.allSettled(pending);
        if (controlFailure) throw controlFailure;
      } finally { stopObserving(); }
    })();
    const abort = () => { rejectLoaded(signal.reason); if (targetId) void release().catch(() => {}); };
    const stopObserving = () => {
      if (!observing) return;
      observing = false;
      unsubscribe();
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await control.send('Target.setDiscoverTargets', { discover: true });
      signal.throwIfAborted();
      const creation = privateTargets.beginCreation();
      try {
        const created = await control.send('Target.createTarget', { url: 'about:blank', browserContextId, background: true });
        if (typeof created.targetId !== 'string' || !created.targetId) throw new Error('Invalid native storage target identity');
        targetId = created.targetId;
        creation.commit(targetId);
      } catch (error) { creation.fail(error); throw error; }
      signal.throwIfAborted();
      const attached = await control.send('Target.attachToTarget', { targetId, flatten: true });
      if (typeof attached.sessionId !== 'string' || !attached.sessionId) throw new Error('Invalid native storage control session');
      sessionId = attached.sessionId;
      const { targetInfo } = await control.send('Target.getTargetInfo', {}, sessionId);
      const identity = targetInfo as { targetId?: unknown; browserContextId?: unknown } | undefined;
      if (identity?.targetId !== targetId || identity.browserContextId !== browserContextId) throw new Error('Native storage target identity mismatch');
      signal.throwIfAborted();
      await control.send('Emulation.setScriptExecutionDisabled', { value: true }, sessionId);
      await control.send('Page.enable', {}, sessionId);
      await control.send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
      await control.send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] }, sessionId);
      signal.throwIfAborted();
      const navigation = await control.send('Page.navigate', { url }, sessionId);
      if (navigation.errorText) throw new Error('Native storage synthetic navigation failed');
      await loaded;
      await Promise.all(pending);
      if (eventFailure) throw eventFailure;
      signal.throwIfAborted();
      await control.send('Fetch.disable', {}, sessionId);
      if (controlFailure) throw controlFailure;
      return { targetId, browserContextId, cdp: { send(method, params) {
        if (controlFailure) return Promise.reject(controlFailure);
        if (detached || destroyed || retirement) return Promise.reject(new Error('Native storage target is closed'));
        return control.send(method, params, sessionId);
      }, detach }, release };
    } catch (error) {
      const cleanup = await Promise.allSettled([release()]);
      if (cleanup[0]!.status === 'rejected') throw new AggregateError([error, cleanup[0]!.reason], 'Native storage preparation and retirement failed');
      throw error;
    }
  };
}
