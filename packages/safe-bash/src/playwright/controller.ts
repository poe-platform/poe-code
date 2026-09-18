import type { PlaywrightAdapter, PlaywrightCodegenAction, PlaywrightContext, PlaywrightContextOptions, PlaywrightLease, PlaywrightPage } from './adapter.js';
import { createSnapshotEngine } from './snapshot.js';
import { capturePlaywrightScreenshot } from './screenshot.js';
import { parseInvocation, validatePlaywrightSessionName, type PlaywrightInvocation } from './invocation.js';
import { formatPlaywrightHelp } from './help.js';
import { registerPlaywrightAbilities, type PlaywrightAbilities, type PlaywrightAbilityRequest } from './abilities.js';
import { executePlaywrightAbility } from './ability-execution.js';
import { createPlaywrightCommandBudget } from './command-budget.js';
import { playwrightCliCompatibilityVersion, playwrightCodeString, serializePlaywrightResult, type PlaywrightCommandResult, type PlaywrightResultSection } from './response.js';
import { capabilityArtifactName } from './capability-result.js';
import { isPlaywrightSnapshotRef, resolvePlaywrightTarget } from './targets.js';
import type { PlaywrightElementHandle, PlaywrightStorageState } from './adapter.js';
import { capturePlaywrightTargetScreenshot } from './target-screenshot.js';
import { flushPlaywrightConsole, observePlaywrightCapabilities } from './capability-events.js';
import { getPlaywrightModal, observePlaywrightModals, onPlaywrightModal } from './modal-capabilities.js';
import { findPlaywrightSnapshot } from './find.js';
import { collectPlaywrightDownloads, observePlaywrightDownloads } from './download-capabilities.js';
import { generatedPlaywrightLocator } from './generated-locator.js';
import { capturePlaywrightRoutes } from './route-capabilities.js';
import { updatePlaywrightHighlight } from './highlight.js';
import { parsePlaywrightContextOptions, resolvePlaywrightOpenOptions } from './open-options.js';
import { playwrightLocatorSelector, setPlaywrightTestIdAttribute } from './locator-selector.js';
import { initializePlaywrightWorkspace } from './workspace.js';
import { parsePlaywrightSessionConfiguration, type PlaywrightSessionConfiguration } from './session-configuration.js';
import { installPlaywrightConfiguredNetwork, playwrightInitPageSource } from './session-runtime.js';
import { flushPlaywrightTrace, preparePlaywrightTraceRelease } from './tracing-capabilities.js';
import { resolvePath } from '../contracts/path.js';

export interface PlaywrightControllerOptions {
  readonly adapter?: PlaywrightAdapter;
  readonly abilities?: PlaywrightAbilities;
  readonly persistence?: PlaywrightSessionPersistence;
  readonly limits?: { readonly maxSessions?: number; readonly actionTimeoutMs?: number; readonly codeExecutionTimeoutMs?: number; readonly maxSnapshotBytes?: number; readonly maxSnapshotRefs?: number; readonly maxArtifactBytes?: number; readonly maxTabs?: number; readonly maxCommandBytes?: number };
  /** Billing declarations are separate; reporting/charging is not implemented. */
  readonly billing?: never;
}
export type PlaywrightSessionState = 'acquiring' | 'open' | 'closing' | 'closed';
export interface PlaywrightSessionRestoreOptions {
  readonly name: string;
  readonly expiresAt?: number;
  readonly idleTimeoutMs?: number;
  readonly contextOptions?: PlaywrightContextOptions;
  readonly configuration?: PlaywrightSessionConfiguration;
  readonly signal?: AbortSignal;
  acquire(options: { readonly signal: AbortSignal }): Promise<{
    readonly lease: PlaywrightLease;
    readonly selectedPage?: PlaywrightPage | undefined;
    /** Runs after ownership validation and event observation, before publication. */
    initialize?(options: { readonly signal: AbortSignal }): Promise<void>;
  }>;
}
export interface PlaywrightSessionCheckpoint {
  readonly name: string;
  readonly context: PlaywrightContext;
  readonly selectedPage?: PlaywrightPage;
  readonly expiresAt?: number;
  readonly idleTimeoutMs?: number;
  readonly contextOptions?: PlaywrightContextOptions;
  readonly configuration?: PlaywrightSessionConfiguration;
}
export interface PlaywrightSessionPersistence {
  /** Enumerates only this owner's resumable profiles; never allocates browsers. */
  list?(signal: AbortSignal): Promise<readonly { readonly name: string; readonly expiresAt?: number }[]>;
  restore(request: { readonly name: string; readonly signal: AbortSignal }): Promise<{
    readonly lease: PlaywrightLease;
    readonly selectedPage?: PlaywrightPage;
    readonly expiresAt?: number;
    readonly idleTimeoutMs?: number;
    readonly contextOptions?: PlaywrightContextOptions;
    readonly configuration?: PlaywrightSessionConfiguration;
    initialize?(options: { readonly signal: AbortSignal }): Promise<void>;
  } | undefined>;
  checkpoint(session: PlaywrightSessionCheckpoint, signal: AbortSignal): Promise<void>;
  /** Explicit closure suppresses automatic resume without deleting saved state. */
  close?(name: string | undefined, signal: AbortSignal): Promise<void>;
  delete(name: string, signal: AbortSignal): Promise<void>;
}
interface Session {
  readonly name: string;
  readonly generation: number;
  state: PlaywrightSessionState;
  lease?: PlaywrightLease;
  page?: PlaywrightPage;
  pages?: PlaywrightPage[];
  readonly snapshot: ReturnType<typeof createSnapshotEngine>;
  readonly cleanups: Set<() => Promise<void>>;
  detachPage?: () => void;
  detachContext?: () => void;
  disposeCapabilities?: () => Promise<void>;
  unsubscribe?: () => void;
  releasing?: Promise<void>;
  failure?: Error;
  pendingActions?: Set<Promise<void>>;
  expiresAt?: number;
  idleTimeoutMs?: number;
  contextOptions?: PlaywrightContextOptions;
  configuration?: PlaywrightSessionConfiguration;
  pageInitializations?: WeakMap<object, Promise<void>>;
  pendingInitializations?: Set<Promise<void>>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  idlePaused?: boolean;
}

export function createPlaywrightController(options: PlaywrightControllerOptions = {}) {
  if (!options || typeof options !== 'object') throw new TypeError('Invalid Playwright configuration');
  if (options.adapter !== undefined && (!options.adapter || typeof options.adapter.acquire !== 'function')) throw new TypeError('An injected Playwright adapter is required');
  if (Object.keys(options).some(key => !['adapter', 'abilities', 'limits', 'billing', 'persistence'].includes(key))) throw new TypeError('Unsupported Playwright configuration');
  if (options.persistence && ['restore', 'checkpoint', 'delete'].some(key => typeof Reflect.get(options.persistence!, key) !== 'function')) throw new TypeError('Invalid Playwright persistence');
  if (options.persistence?.close !== undefined && typeof options.persistence.close !== 'function') throw new TypeError('Invalid Playwright persistence close');
  if (options.persistence?.list !== undefined && typeof options.persistence.list !== 'function') throw new TypeError('Invalid Playwright persistence list');
  if (options.limits !== undefined && (!options.limits || typeof options.limits !== 'object' || Object.keys(options.limits).some(key => !['maxSessions', 'actionTimeoutMs', 'codeExecutionTimeoutMs', 'maxSnapshotBytes', 'maxSnapshotRefs', 'maxArtifactBytes', 'maxTabs', 'maxCommandBytes'].includes(key)))) throw new TypeError('Unsupported Playwright limits');
  if (options.billing !== undefined) throw new Error('Live billing is not implemented');
  const maxSessions = options.limits?.maxSessions ?? 4;
  const actionTimeoutMs = options.limits?.actionTimeoutMs ?? 5_000;
  // Isolated startup and multiple native actions share this host budget, not one action's timeout.
  const codeExecutionTimeoutMs = options.limits?.codeExecutionTimeoutMs ?? 30_000;
  const maxSnapshotBytes = options.limits?.maxSnapshotBytes ?? 256 * 1024;
  const maxSnapshotRefs = options.limits?.maxSnapshotRefs ?? 1000;
  const maxArtifactBytes = options.limits?.maxArtifactBytes ?? 16 * 1024 * 1024;
  const maxTabs = options.limits?.maxTabs ?? 16;
  const maxCommandBytes = options.limits?.maxCommandBytes ?? 16 * 1024 * 1024;
  const abilities = registerPlaywrightAbilities(options.abilities, options.adapter !== undefined);
  let refSequence = 0;
  for (const value of [maxSessions, actionTimeoutMs, codeExecutionTimeoutMs, maxSnapshotBytes, maxSnapshotRefs, maxArtifactBytes, maxTabs, maxCommandBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid Playwright limit');
  const sessions = new Map<string, Session>();
  const explicitlyClosed = new Set<string>();
  let suppressUnknownRestores = false;
  const tails = new Map<string, Promise<void>>();
  const work = new Set<Promise<unknown>>();
  const lifetime = new AbortController();
  let generation = 0;
  let disposal: Promise<void> | undefined;
  const sessionActionTimeout = (session?: Session) => session?.configuration?.timeouts?.action ?? actionTimeoutMs;
  const sessionNavigationTimeout = (session?: Session) => session?.configuration?.timeouts?.navigation ?? options.limits?.actionTimeoutMs ?? 60_000;
  const initializeContext = async (session: Session) => {
    if (session.configuration?.codegen && !['typescript', 'none'].includes(session.configuration.codegen) && !session.lease?.generateActionCode) throw new Error('Configured codegen language requires native action generation');
    await installPlaywrightConfiguredNetwork(session.lease!.context, session.configuration);
    const configured = session.lease!.context as PlaywrightContext & { setDefaultTimeout?(timeout: number): void; setDefaultNavigationTimeout?(timeout: number): void };
    configured.setDefaultTimeout?.(sessionActionTimeout(session));
    configured.setDefaultNavigationTimeout?.(sessionNavigationTimeout(session));
    const scripts = session.configuration?.initScripts;
    if (!scripts?.length) return;
    const context = session.lease!.context;
    if (!context.addInitScript) throw new Error('Browser context init scripts unsupported');
    // One native registration preserves source order across every future page.
    await context.addInitScript({ content: scripts.join('\n;\n') });
  };
  const savedSessions = async (signal: AbortSignal): Promise<readonly { name: string; expiresAt?: number }[]> => {
    const entries = await options.persistence?.list?.(signal) ?? [];
    signal.throwIfAborted();
    if (!Array.isArray(entries) || entries.length > maxSnapshotRefs) throw new PlaywrightResourceLimitError('Playwright session list limit exceeded');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid persisted session');
      validatePlaywrightSessionName(entry.name);
      if (entry.expiresAt !== undefined && (!Number.isSafeInteger(entry.expiresAt) || entry.expiresAt < 0)) throw new Error('Invalid persisted session expiry');
    }
    return entries.filter(entry => !explicitlyClosed.has(entry.name) && (!suppressUnknownRestores || sessions.get(entry.name)?.state === 'open') && (entry.expiresAt === undefined || entry.expiresAt > Date.now()));
  };
  const checkpoint = async (session: Session, signal: AbortSignal, activity = true) => {
    if (activity && session.idleTimeoutMs) session.expiresAt = Date.now() + session.idleTimeoutMs;
    scheduleExpiry(session);
    if (!options.persistence || session.state !== 'open' || !session.lease || session.failure) return;
    if (session.lease.context.pages().some(page => getPlaywrightModal(page))) return;
    signal.throwIfAborted();
    await options.persistence.checkpoint({ name: session.name, context: session.lease.context,
      ...(session.page ? { selectedPage: session.page } : {}), ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
      ...(session.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: session.idleTimeoutMs }),
      ...(session.contextOptions === undefined ? {} : { contextOptions: structuredClone(session.contextOptions) }),
      ...(session.configuration === undefined ? {} : { configuration: structuredClone(session.configuration) }) }, signal);
    signal.throwIfAborted();
  };
  const release = (session: Session): Promise<void> => {
    if (session.releasing) return session.releasing;
    session.state = 'closing';
    clearTimeout(session.expiryTimer);
    session.releasing = Promise.resolve().then(async () => {
      try {
        // Native tracing must flush while the context is still alive. Arbitrary
        // cleanup remains concurrent with lease closure to unblock browser work.
        const traceResults = session.lease ? await Promise.allSettled([preparePlaywrightTraceRelease(session.lease.context)]) : [];
        const callbacks = [...session.cleanups];
        session.cleanups.clear();
        const custom = callbacks.map(cleanup => Promise.resolve().then(cleanup));
        const results = await Promise.allSettled([
          Promise.resolve().then(() => session.detachPage?.()), Promise.resolve().then(() => session.detachContext?.()), Promise.resolve().then(() => session.disposeCapabilities?.()), ...custom,
          session.snapshot.invalidate(true), Promise.resolve().then(() => session.unsubscribe?.()),
          Promise.resolve().then(() => session.lease?.release()),
          ...[...session.pendingActions ?? []].map(action => action.catch(() => {})),
          ...[...session.pendingInitializations ?? []].map(action => action.catch(() => {})),
        ]);
        const errors = [...traceResults, ...results].flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Playwright session retirement failed');
      }
      finally {
        delete session.page;
        session.state = 'closed';
      }
    });
    // Notifications and abort handlers cannot throw unhandled rejections.
    void session.releasing.catch(() => {});
    return session.releasing;
  };
  const checkpointAndRelease = async (session: Session, signal: AbortSignal): Promise<void> => {
    const errors: unknown[] = [];
    try { await checkpoint(session, signal, false); } catch (error) { errors.push(error); }
    try { await release(session); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Playwright checkpoint and retirement failed');
  };
  const enqueue = <T>(name: string, task: () => Promise<T>): Promise<T> => {
    const operation = (tails.get(name) ?? Promise.resolve()).then(task);
    const tail = operation.then(() => {}, () => {});
    tails.set(name, tail);
    void tail.then(() => { if (tails.get(name) === tail) tails.delete(name); });
    return operation;
  };
  const enforceTabLimit = (session: Session) => {
    if (!session.lease || session.releasing || session.lease.context.pages().length <= maxTabs) return;
    session.failure = new PlaywrightResourceLimitError('Playwright tab limit exceeded');
    void release(session).catch(() => {});
  };
  const selectPage = async (session: Session, page: PlaywrightPage, check: () => void) => {
    check();
    await initializePage(session, page);
    check();
    session.detachPage?.();
    await session.snapshot.invalidate();
    check();
    session.page = page;
    if (page.on && page.off) {
      const invalidate = () => { void session.snapshot.invalidate().catch(() => {}); };
      const closed = () => { if (session.page === page) delete session.page; invalidate(); };
      session.detachPage = () => { page.off!('framenavigated', invalidate); page.off!('close', closed); };
      page.on('framenavigated', invalidate);
      page.on('close', closed);
    }
  };
  const initializePage = async (session: Session, page: PlaywrightPage): Promise<void> => {
    const key = page.mainFrame?.() ?? page;
    setPlaywrightTestIdAttribute(page, session.configuration?.testIdAttribute);
    session.pageInitializations ??= new WeakMap();
    let operation = session.pageInitializations.get(key);
    if (!operation) {
      operation = (async () => {
        for (const module of session.configuration?.initPages ?? []) {
          if (!session.lease?.executeCode) throw new Error('Browser initPage requires isolated native code execution');
          try {
            await session.lease.executeCode({ page, source: playwrightInitPageSource(module.source), signal: lifetime.signal,
              timeoutMs: codeExecutionTimeoutMs, maxOutputBytes: maxCommandBytes, maxPages: maxTabs });
          } catch (cause) { throw new Error(`Failed to load init page "${module.filename}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
        }
      })();
      session.pageInitializations.set(key, operation);
      (session.pendingInitializations ??= new Set()).add(operation);
      void operation.then(() => { session.pendingInitializations!.delete(operation!); }, error => { session.pendingInitializations!.delete(operation!); session.failure = error instanceof Error ? error : new Error(String(error)); });
    }
    await operation;
  };
  const observeContext = (session: Session): void => {
    session.detachContext?.();
    const context = session.lease!.context;
    const onPage = (page: PlaywrightPage) => { enforceTabLimit(session); void initializePage(session, page).catch(() => {}); };
    session.detachContext = () => { context.off('page', onPage); };
    const cleanups: (() => Promise<void>)[] = [];
    session.disposeCapabilities = async () => {
      const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Browser observation cleanup failed');
    };
    observePlaywrightCapabilities(context, cleanup => cleanups.push(cleanup), { maxCommandBytes, maxArtifactBytes });
    observePlaywrightModals(context, cleanup => cleanups.push(cleanup));
    observePlaywrightDownloads(context, cleanup => cleanups.push(cleanup), { maxMetadataBytes: maxCommandBytes });
    context.on('page', onPage);
  };
  const observeSession = (session: Session): void => {
    const unsubscribe = session.lease!.onClosed(() => {
      if (sessions.get(session.name) !== session || session.state === 'closed') return;
      delete session.page;
      session.state = 'closed';
      void release(session).catch(() => {});
    });
    session.unsubscribe = unsubscribe;
    if (session.releasing) { unsubscribe(); throw new Error(`Session closed: ${session.name}`); }
    observeContext(session);
  };
  const retireExpired = (): Promise<void> | undefined => {
    const now = Date.now();
    const expired = [...sessions.values()].filter(session => session.state === 'open' && !session.idlePaused && session.expiresAt !== undefined && session.expiresAt <= now);
    if (!expired.length) return undefined;
    return Promise.allSettled(expired.map(session => {
      explicitlyClosed.add(session.name);
      session.failure = new Error(`Session expired: ${session.name}; reopen explicitly`);
      return release(session);
    })).then(results => {
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Playwright expiry cleanup failed');
    });
  };
  const scheduleExpiry = (session: Session) => {
    clearTimeout(session.expiryTimer);
    if (session.expiresAt === undefined || session.state !== 'open') return;
    session.expiryTimer = setTimeout(() => {
      void enqueue(session.name, async () => {
        await retireExpired();
        if (session.state === 'open') scheduleExpiry(session);
      }).catch(() => {});
    }, Math.min(2_147_483_647, Math.max(0, session.expiresAt - Date.now())));
    (session.expiryTimer as unknown as { unref?(): void }).unref?.();
  };
  const inspectSessions = (): readonly PlaywrightSessionCheckpoint[] => Object.freeze([...sessions.values()]
    .filter(session => session.state === 'open' && (session.expiresAt === undefined || session.expiresAt > Date.now()))
    .map(session => Object.freeze({ name: session.name, context: session.lease!.context,
      ...(session.page === undefined ? {} : { selectedPage: session.page }),
      ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
      ...(session.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: session.idleTimeoutMs }),
      ...(session.contextOptions === undefined ? {} : { contextOptions: structuredClone(session.contextOptions) }),
      ...(session.configuration === undefined ? {} : { configuration: structuredClone(session.configuration) }),
    })));
  const restoreSession = async (request: PlaywrightSessionRestoreOptions, withinQueue = false): Promise<void> => {
    if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['name', 'expiresAt', 'idleTimeoutMs', 'contextOptions', 'configuration', 'signal', 'acquire'].includes(key))
      || typeof request.acquire !== 'function' || request.signal !== undefined && typeof request.signal.throwIfAborted !== 'function') throw new TypeError('Invalid Playwright session restoration');
    validatePlaywrightSessionName(request.name);
    if (request.expiresAt !== undefined && (!Number.isSafeInteger(request.expiresAt) || request.expiresAt < 0)) throw new TypeError('Invalid Playwright session expiry');
    if (request.idleTimeoutMs !== undefined && (!Number.isSafeInteger(request.idleTimeoutMs) || request.idleTimeoutMs < 0)) throw new TypeError('Invalid Playwright idle timeout');
    const { name, expiresAt, acquire } = request;
    const signal = request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal;
    const check = () => {
      signal.throwIfAborted();
      if (expiresAt !== undefined && expiresAt <= Date.now()) throw new Error(`Session expired: ${name}; reopen explicitly`);
    };
    check();
    const restore = async () => {
      check();
      await retireExpired();
      const previous = sessions.get(name);
      if (previous && previous.state !== 'closed') throw new Error(`Session already ${previous.state}: ${name}`);
      if (previous?.releasing) await previous.releasing;
      check();
      if ([...sessions.values()].filter(session => session.state !== 'closed').length >= maxSessions) throw new PlaywrightResourceLimitError('Playwright session capacity exceeded');
      const epoch = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => String(value).padStart(10, '0')).join('');
      const session: Session = { name, generation: ++generation, state: 'acquiring', cleanups: new Set(),
        snapshot: createSnapshotEngine({ maxSnapshotBytes, maxSnapshotRefs }, () => `e${epoch}${++refSequence}`),
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(request.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: request.idleTimeoutMs }),
        ...(request.contextOptions === undefined ? {} : { contextOptions: parsePlaywrightContextOptions(request.contextOptions, maxArtifactBytes) }),
        ...(request.configuration === undefined ? {} : { configuration: parsePlaywrightSessionConfiguration(request.configuration, maxArtifactBytes) }),
      };
      sessions.set(name, session);
      const cancel = () => { if (session.lease) void release(session).catch(() => {}); };
      try {
        const restored = await acquire.call(request, { signal });
        session.lease = restored.lease;
        check();
        if (!session.lease || typeof session.lease.release !== 'function' || typeof session.lease.onClosed !== 'function'
          || !session.lease.context || ['pages', 'newPage', 'close', 'on', 'off'].some(key => typeof Reflect.get(session.lease!.context, key) !== 'function')) throw new TypeError('Invalid restored Playwright lease');
        signal.addEventListener('abort', cancel, { once: true });
        observeSession(session);
        await initializeContext(session);
        const pages = [...session.lease.context.pages()];
        if (pages.length > maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
        if (restored.selectedPage !== undefined) {
          if (!pages.includes(restored.selectedPage)) throw new Error('Selected tab does not belong to the restored context');
          await selectPage(session, restored.selectedPage, check);
        }
        check();
        if (restored.initialize !== undefined) {
          if (typeof restored.initialize !== 'function') throw new TypeError('Invalid Playwright session initializer');
          await restored.initialize({ signal });
          check();
        }
        if (session.releasing) throw new Error(`Session closed: ${name}`);
        const currentPages = [...session.lease.context.pages()];
        if (currentPages.length > maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
        if (restored.selectedPage !== undefined && !currentPages.includes(restored.selectedPage)) throw new Error('Selected tab closed during restoration');
        session.pages = currentPages;
        session.state = 'open';
        scheduleExpiry(session);
      } catch (error) {
        const reason = signal.aborted ? signal.reason : error;
        try { await release(session); }
        catch (cleanupError) { throw new AggregateError([reason, cleanupError], 'Playwright restoration and cleanup failed'); }
        throw reason;
      } finally { signal.removeEventListener('abort', cancel); }
    };
    const operation = withinQueue ? restore() : enqueue(name, restore);
    work.add(operation);
    try { await operation; }
    finally { work.delete(operation); }
  };
  const run = async (invocation: PlaywrightInvocation): Promise<void> => {
    const commandBudget = createPlaywrightCommandBudget(maxCommandBytes);
    const writtenFiles = new Set<string>();
    const original = invocation;
    if (original.writeArtifact) invocation = { ...original, async writeArtifact(bytes, filename) {
      await original.writeArtifact!(bytes, filename);
      if (filename !== undefined) writtenFiles.add(resolvePath(original.workspace?.cwd ?? '/', filename));
    } };
    if (lifetime.signal.aborted) throw new Error('Playwright controller is disposed');
    const parsed = parseInvocation(invocation, abilities, options.adapter);
    invocation.signal.throwIfAborted();
    const local = new AbortController();
    let active: Session | undefined;
    let traceFlushed = false;
    let retained = false;
    let finished = false;
    let cleanupCompletion: Promise<void> | undefined;
    const ownedTargets = new Set<PlaywrightElementHandle>();
    const targetLocators = new Map<string, string>();
    const cleanup = (): Promise<void> => {
      if (cleanupCompletion) return cleanupCompletion;
      // Install completion before abort dispatch can reenter cleanup.
      cleanupCompletion = Promise.resolve().then(async () => {
        await operation.catch(() => {});
        const retirements = [...ownedTargets].map(handle => handle.dispose());
        if (active && (!retained || active.releasing)) retirements.push(release(active));
        const settled = await Promise.allSettled(retirements);
        const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Playwright invocation cleanup failed');
      });
      void cleanupCompletion.catch(() => {});
      // Close admission immediately and unblock cooperative browser work before
      // waiting for the operation, including opaque late acquisition.
      if (!finished) local.abort(new Error('Playwright invocation cleaned up'));
      if (active && (!retained || !finished) && active.lease) void release(active).catch(() => {});
      return cleanupCompletion;
    };
    // Synchronous registration precedes queue admission and all browser effects.
    invocation.registerCleanup?.(cleanup);
    const abort = () => {
      local.abort(invocation.signal.aborted ? invocation.signal.reason : lifetime.signal.reason);
      if (active && (!retained || !finished) && active.lease) void release(active).catch(() => {});
    };
    invocation.signal.addEventListener('abort', abort, { once: true });
    lifetime.signal.addEventListener('abort', abort, { once: true });
    if (invocation.signal.aborted || lifetime.signal.aborted) abort();
    const check = () => {
      invocation.signal.throwIfAborted();
      local.signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
    };
    const write = async (text: string) => {
      check();
      if (text.length > commandBudget.remaining) throw new PlaywrightResourceLimitError('Playwright command byte limit exceeded');
      commandBudget.admit(new TextEncoder().encode(text).byteLength);
      await invocation.write(text);
      check();
    };
    const writeArtifact = async (bytes: Uint8Array, filename?: string) => {
      check();
      if (!invocation.writeArtifact) throw new Error('Artifact byte destination unsupported');
      if (bytes.byteLength > maxArtifactBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
      commandBudget.admit(bytes.byteLength);
      await invocation.writeArtifact(bytes, filename);
      check();
    };
    const writeResult = async (result: PlaywrightCommandResult) => {
      check();
      await write(serializePlaywrightResult(configuredResult(result), parsed));
    };
    const configuredResult = (result: PlaywrightCommandResult): PlaywrightCommandResult => {
      const language = active?.configuration?.codegen ?? 'typescript';
      return { sections: result.sections.flatMap(section => section.title !== 'Ran Playwright code' ? [section] : language === 'none' ? [] : [{ ...section, codeframe: language === 'typescript' ? 'js' : language }]) };
    };
    const actionCode = (session: Session, action: PlaywrightCodegenAction, fallback: string) => {
      const language = session.configuration?.codegen ?? 'typescript';
      if (language === 'none') return '';
      if (!session.lease?.generateActionCode) {
        if (language !== 'typescript') throw new Error('Configured codegen language requires native action generation');
        return fallback;
      }
      const code = session.lease.generateActionCode({ language, action });
      if (typeof code !== 'string' || new TextEncoder().encode(code).byteLength > maxCommandBytes) throw new PlaywrightResourceLimitError('Playwright generated code byte limit exceeded');
      return code;
    };
    const enforceOutputBudget = async () => {
      const limit = active?.configuration?.outputMaxSize;
      if (!limit) return;
      const workspace = invocation.workspace;
      if (!workspace?.listFiles || !workspace.removeFile) throw new Error('Playwright outputMaxSize requires virtual workspace retention support');
      const directory = resolvePath(workspace.cwd, active?.configuration?.outputDir ?? '.playwright-cli');
      const files = await workspace.listFiles(directory, 4096);
      check();
      if (!Array.isArray(files) || files.length > 4096) throw new PlaywrightResourceLimitError('Playwright output directory entry limit exceeded');
      const unique = new Set<string>();
      let total = 0;
      for (const entry of files) {
        const name = resolvePath(workspace.cwd, entry.filename);
        if (!name.startsWith(directory.endsWith('/') ? directory : directory + '/') || unique.has(name) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isFinite(entry.mtimeMs)) throw new Error('Invalid Playwright output file metadata');
        unique.add(name); total += entry.size;
      }
      for (const entry of [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (total <= limit) break;
        const filename = resolvePath(workspace.cwd, entry.filename);
        if (writtenFiles.has(filename)) continue;
        await workspace.removeFile(filename); check(); total -= entry.size;
      }
    };
    const downloadSections = async (session: Session): Promise<PlaywrightResultSection[]> => {
      if (!session.page) return [];
      const downloads = await collectPlaywrightDownloads(session.page, session.lease?.captureArtifact, { signal: local.signal, maxBytes: Math.min(maxArtifactBytes, maxCommandBytes), ...(session.configuration ? { configuration: session.configuration } : {}) }, session.lease?.captureDownload);
      if (!downloads.length) return [];
      if (!invocation.writeArtifact) throw new Error('Artifact byte destination unsupported');
      for (const download of downloads) await writeArtifact(download.bytes, download.filename);
      return [{ title: 'Events', content: downloads.map(download => `- Downloaded file [${download.filename.split('/').at(-1)}](${download.filename})`).join('\n') }];
    };
    const flushTrace = async (session: Session): Promise<string[]> => {
      if (!session.lease?.captureTrace) return [];
      return flushPlaywrightTrace(session.lease.context, session.lease.captureTrace, {
        signal: local.signal, maxBytes: Math.min(maxArtifactBytes, commandBudget.remaining), writeArtifact,
        ...(invocation.workspace ? { mkdir: (path: string) => invocation.workspace!.mkdir(path) } : {}),
      });
    };
    const retireForCommand = async (session: Session, force = false) => {
      const errors: unknown[] = [];
      if (!force) try { await flushTrace(session); } catch (error) { errors.push(error); }
      try { await (force ? release(session) : checkpointAndRelease(session, local.signal)); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Playwright trace flush and retirement failed');
    };
    const pageResult = async (session: Session, code: string | undefined, snapshot: 'none' | 'inline' | 'file' = 'none', filename?: string): Promise<PlaywrightCommandResult> => {
      const sections: PlaywrightResultSection[] = [];
      if (code) sections.push({ title: 'Ran Playwright code', content: code, codeframe: 'js' });
      const page = session.page;
      if (!page) return { sections };
      const modal = getPlaywrightModal(page);
      if (modal) {
        sections.push({ title: 'Modal state', content: modal.kind === 'dialog'
          ? `- ["${modal.dialog.type()}" dialog with message "${modal.dialog.message()}"]: can be handled by dialog-accept or dialog-dismiss`
          : '- [File chooser]: can be handled by upload' });
        return { sections };
      }
      sections.push(...await downloadSections(session));
      if (invocation.writeArtifact) {
        const consoleLink = await flushPlaywrightConsole(session.lease!.context, page, { ...(session.configuration ? { configuration: session.configuration } : {}), writeArtifact });
        if (consoleLink) sections.push({ title: 'Events', content: `- New console entries: ${consoleLink}` });
      }
      const title = await page.title?.();
      sections.push({ title: 'Page', content: `- Page URL: ${page.url()}${title === undefined ? '' : `\n- Page Title: ${title}`}` });
      if (snapshot !== 'none' && (page.frames || page.ariaSnapshot || page._snapshotForAI || page.ariaSnapshotJSON || session.lease?.captureSnapshotJSON)) {
        const snapshotOptions: { depth?: number; boxes?: boolean; root?: PlaywrightElementHandle; timeout?: number } = { timeout: sessionActionTimeout(session), ...(session.configuration?.snapshot?.boxes === undefined ? {} : { boxes: session.configuration.snapshot.boxes }) };
        if (parsed.command === 'snapshot') {
          if (parsed.options.depth !== undefined) {
            const depth = Number(parsed.options.depth);
            if (!Number.isSafeInteger(depth) || depth < 0) throw new Error('Invalid snapshot depth');
            snapshotOptions.depth = depth;
          }
          if (parsed.options.boxes) snapshotOptions.boxes = true;
          if (parsed.args[0]) snapshotOptions.root = await resolveTarget(session, parsed.args[0]);
        }
        if (parsed.command === 'snapshot' && parsed.json && filename === undefined) {
          retained = false;
          const tree = await session.snapshot.captureJSON(page, local.signal, { ...snapshotOptions, ...(session.lease?.captureSnapshotJSON ? { captureJSON: session.lease.captureSnapshotJSON } : {}) });
          check();
          sections.push({ title: 'Snapshot', content: { json: tree as unknown as import('./response.js').PlaywrightJsonValue }, codeframe: 'json' });
          return { sections };
        }
        const text = await session.snapshot.capture(page, local.signal, snapshotOptions);
        check();
        if (filename !== undefined || snapshot === 'file' && invocation.writeArtifact) {
          const target = filename ?? capabilityArtifactName('page', 'yml', session.configuration);
          const bytes = new TextEncoder().encode(text);
          if (bytes.byteLength > maxArtifactBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
          if (!invocation.writeArtifact) throw new Error('Artifact byte destination unsupported');
          await writeArtifact(bytes, target);
          sections.push({ title: 'Snapshot', content: `- [Snapshot](${target})` });
        } else sections.push({ title: 'Snapshot', content: text.trimEnd(), codeframe: 'yaml' });
      }
      return { sections };
    };
    const checkSession = (session: Session) => {
      check();
      if (!session.idlePaused && session.expiresAt !== undefined && session.expiresAt <= Date.now()) {
        session.failure = new Error(`Session expired: ${session.name}; reopen explicitly`);
        void release(session).catch(() => {});
      }
      enforceTabLimit(session);
      if (session.releasing) throw session.failure ?? new Error(`Session closed: ${session.name}; reopen explicitly`);
    };
    const resolveTarget = async (session: Session, target: string) => {
      checkSession(session);
      if (!session.page) throw new Error('Selected tab closed; select a tab explicitly');
      const handle = await resolvePlaywrightTarget({ target, page: session.page, timeout: sessionActionTimeout(session), signal: local.signal,
        resolveRef: ref => session.snapshot.resolve(ref), own: handle => ownedTargets.add(handle) });
      checkSession(session);
      if (!targetLocators.has(target)) {
        const reference = isPlaywrightSnapshotRef(target);
        const selector = reference ? session.snapshot.nativeSelector(target) : target;
        let description = `locator(${playwrightCodeString(selector ?? `aria-ref=${target}`)})`;
        if (selector && session.page.locator) {
          const locator = session.page.locator(reference ? selector : playwrightLocatorSelector(session.page, selector));
          if (reference ? locator.normalize || locator._resolveSelector : locator.toString() !== '[object Object]') description = await generatedPlaywrightLocator(session.page, selector, reference);
        }
        targetLocators.set(target, `page.${description}`);
      }
      return handle;
    };
    const canRetainAfterError = (session: Session | undefined, error: unknown): boolean => {
      if (!session || session.state !== 'open' || !session.lease || session.failure || session.releasing || local.signal.aborted
        || isPlaywrightResourceLimitError(error) || session.pendingActions?.size) return false;
      try {
        const pages = session.lease.context.pages();
        return pages.length <= maxTabs && (!session.page || pages.includes(session.page));
      } catch { return false; }
    };
    const runAction = async (session: Session, action: () => Promise<void>): Promise<void> => {
      checkSession(session);
      const page = session.page;
      if (!page) throw new Error('Selected tab closed; select a tab explicitly');
      if (getPlaywrightModal(page)) { retained = true; throw new Error(`Tool "${parsed.command}" does not handle the modal state.`); }
      await Promise.all([...session.pendingActions ?? []]);
      checkSession(session);
      let yielded!: () => void;
      const modal = new Promise<void>(resolve => { yielded = resolve; });
      const unsubscribe = onPlaywrightModal(page, value => { if (value) yielded(); });
      const targets: PlaywrightElementHandle[] = [];
      let settled = false;
      let returnedForModal = false;
      const operation = (async () => {
        const errors: unknown[] = [];
        try {
          await session.snapshot.withReferences(async () => {
            await action();
            // The native CLI allows queued browser events to settle after an action.
            await page.waitForTimeout?.(session.configuration?.timeouts?.settle ?? 500);
          });
        } catch (error) { errors.push(error); }
        settled = true;
        const results = await Promise.allSettled(targets.map(target => target.dispose()));
        errors.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason] : []));
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Playwright action and target cleanup failed');
      })();
      (session.pendingActions ??= new Set()).add(operation);
      void operation.then(() => { session.pendingActions!.delete(operation); }, error => {
        session.pendingActions!.delete(operation);
        if (returnedForModal && getPlaywrightModal(page) && error instanceof Error && error.name === 'TimeoutError') return;
        if (!session.releasing && (returnedForModal || isPlaywrightResourceLimitError(error))) {
          session.failure = error instanceof Error ? error : new Error(String(error));
          void release(session).catch(() => {});
        }
      });
      try {
        if (getPlaywrightModal(page)) yielded();
        await Promise.race([operation, modal]);
        checkSession(session);
        returnedForModal = !!getPlaywrightModal(page);
        if (!settled) { targets.push(...ownedTargets); ownedTargets.clear(); }
      } catch (error) {
        if (canRetainAfterError(session, error)) retained = true;
        throw error;
      } finally { unsubscribe(); }
    };
    const replaceContext = async (session: Session, state: PlaywrightStorageState) => {
      checkSession(session);
      if (!session.lease?.replaceContext) throw new Error('Storage state restoration is unavailable in this browser');
      const restoreRoutes = capturePlaywrightRoutes(session.lease.context);
      const pages = session.lease.context.pages();
      const selected = session.page ? pages.indexOf(session.page) : -1;
      const urls = pages.map(page => page.url());
      session.detachPage?.();
      session.detachContext?.();
      await session.disposeCapabilities?.();
      await session.snapshot.invalidate();
      const context = await session.lease.replaceContext(state, { signal: local.signal });
      checkSession(session);
      await initializeContext(session);
      observeContext(session);
      delete session.page;
      for (const [index, url] of urls.entries()) {
        if (context.pages().length >= maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
        const page = await context.newPage();
        await initializePage(session, page);
        if (index === 0) await restoreRoutes?.(context, cleanup => session.cleanups.add(cleanup));
        if (url !== 'about:blank') await page.goto(url, { timeout: sessionNavigationTimeout(session) });
        if (index === selected) await selectPage(session, page, () => checkSession(session));
      }
      session.pages = [...context.pages()];
      checkSession(session);
    };
    const execute = async () => {
      check();
      if (parsed.command === 'help') {
        const help = formatPlaywrightHelp(parsed.topic, abilities);
        await write(parsed.json ? JSON.stringify({ help: help.trimEnd() }, null, 2) + '\n' : help);
        check();
        return;
      }
      if (parsed.command === 'version') {
        await write(parsed.json ? JSON.stringify({ version: playwrightCliCompatibilityVersion }, null, 2) + '\n' : playwrightCliCompatibilityVersion + '\n');
        check();
        return;
      }
      const ability = abilities.get(parsed.command)!;
      if (parsed.command === 'attach' && !ability.execute) {
        const targets = [parsed.args[0], parsed.options.cdp, parsed.options.endpoint, parsed.options.extension].filter(Boolean);
        if (targets.length > 1) throw new Error('only one of [name], --cdp, --endpoint, or --extension can be specified');
        if (!targets.length || parsed.options.extension === true) throw new Error('no target specified for attach command; use one of [name], --cdp, --endpoint, or --extension to specify the target to attach to.');
        throw new Error('An authenticated browser attachment broker is unavailable in this host');
      }
      if (parsed.command === 'detach' && !ability.execute) {
        const known = sessions.has(parsed.session) || (await savedSessions(local.signal)).some(session => session.name === parsed.session);
        if (known) throw new Error(parsed.json ? `session '${parsed.session}' was not attached; use close to stop it.` : `session '${parsed.session}' was not attached; use \`playwright-cli${parsed.session === 'default' ? '' : ` -s=${parsed.session}`} close\` to stop it.`);
        await write(parsed.json ? JSON.stringify({ session: parsed.session, status: 'not-attached' }, null, 2) + '\n' : `Browser '${parsed.session}' is not attached.\n`);
        return;
      }
      if (parsed.command === 'install' && !ability.execute) {
        await initializePlaywrightWorkspace(parsed.options, invocation, Math.min(maxArtifactBytes, maxCommandBytes));
        return;
      }
      if (parsed.command === 'install-browser' && !ability.execute) {
        const browser = parsed.args[0] === 'chrome' ? 'chromium' : parsed.args[0] ?? 'chromium';
        if (!options.adapter || !Object.hasOwn(options.adapter.browsers, browser)) throw new Error(`Unsupported browser: ${browser}`);
        if (parsed.options.force || parsed.options['with-deps']) throw new Error('Browser installation is managed by the configured provider');
        if (parsed.options.list || parsed.options['dry-run']) await write(`Browser: ${browser}\n  Install location: provider-managed\n`);
        return;
      }
      const expiryRetirement = retireExpired();
      if (expiryRetirement) await expiryRetirement;
      check();
      if (parsed.command === 'list' && !ability.execute) {
        const saved = await savedSessions(local.signal);
        const known = new Map<string, { name: string; status: string }>();
        for (const entry of saved) {
          known.set(entry.name, { name: entry.name, status: 'open' });
        }
        for (const session of sessions.values()) if (session.state === 'open') known.set(session.name, { name: session.name, status: session.state });
        const browsers = [...known.values()];
        await write(parsed.json ? JSON.stringify({ browsers }, null, 2) + '\n' : browsers.length ? '### Browsers\n' + browsers.map(browser => `- ${browser.name}:\n  - status: ${browser.status}\n`).join('') : '  (no browsers)\n');
        check();
        return;
      }
      if ((parsed.command === 'close-all' || parsed.command === 'kill-all') && !ability.execute) {
        const saved = await savedSessions(local.signal);
        suppressUnknownRestores = true;
        const closed = [...new Set([...saved.map(session => session.name), ...[...sessions.values()].filter(session => session.state === 'open').map(session => session.name)])];
        if (parsed.command === 'kill-all') for (const session of sessions.values()) void release(session).catch(() => {});
        const results = await Promise.allSettled([...new Set([...sessions.keys(), ...tails.keys()])].map(name => enqueue(name, async () => {
          check();
          explicitlyClosed.add(name);
          const session = sessions.get(name);
          if (session) await retireForCommand(session, parsed.command === 'kill-all');
        })));
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        try { await options.persistence?.close?.(undefined, local.signal); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Playwright close-all failed');
        if (parsed.json) await write(JSON.stringify({ closed }, null, 2) + '\n');
        check();
        return;
      }
      await enqueue(parsed.session, async () => {
        let paused: Session | undefined;
        let commandFailure: { error: unknown } | undefined;
        await (async () => {
          check();
          if (options.persistence && ability.scope === 'session' && !['open', 'close', 'close-all', 'list', 'delete-data'].includes(parsed.command)
            && !explicitlyClosed.has(parsed.session) && (!suppressUnknownRestores || sessions.has(parsed.session))
            && (!sessions.has(parsed.session) || sessions.get(parsed.session)!.state === 'closed')) {
            const restored = await options.persistence.restore({ name: parsed.session, signal: local.signal });
            if (restored) {
              let transferred = false;
              try {
                await restoreSession({ name: parsed.session, signal: local.signal,
                  ...(restored.expiresAt === undefined ? {} : { expiresAt: restored.expiresAt }),
                  ...(restored.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: restored.idleTimeoutMs }),
                  ...(restored.contextOptions === undefined ? {} : { contextOptions: restored.contextOptions }),
                  ...(restored.configuration === undefined ? {} : { configuration: restored.configuration }),
                  acquire: async () => { transferred = true; return restored; } }, true);
              } catch (error) {
                if (!transferred) {
                  try { await restored.lease.release(); }
                  catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Playwright restoration and cleanup failed'); }
                }
                throw error;
              }
            }
            check();
          }
          const current = sessions.get(parsed.session);
          if (current?.state === 'open' && current.idleTimeoutMs) {
            paused = current;
            current.idlePaused = true;
            clearTimeout(current.expiryTimer);
          }
          const modalPage = current?.page;
          if (modalPage && getPlaywrightModal(modalPage) && !['dialog-accept', 'dialog-dismiss', 'upload', 'snapshot', 'close', 'delete-data', 'tab-select', 'tab-close'].includes(parsed.command)) {
            retained = true;
            throw new Error(`Tool "${parsed.command}" does not handle the modal state.`);
          }
          if (ability.execute) {
            let browserSession: PlaywrightAbilityRequest['browserSession'];
            if (ability.scope === 'session') {
              const session = sessions.get(parsed.session);
              if (!session || session.state !== 'open') throw new Error(`Session closed: ${parsed.session}; reopen explicitly`);
              active = session;
              checkSession(session);
              const pages = [...session.lease!.context.pages()];
              if (!session.pages || pages.length !== session.pages.length || pages.some((page, index) => page !== session.pages![index])) await session.snapshot.invalidate();
              session.pages = pages;
              if (session.page && !pages.includes(session.page)) {
                session.detachPage?.();
                delete session.page;
              }
              checkSession(session);
              browserSession = Object.freeze({
                context: session.lease!.context,
                page: session.page,
                ...(session.configuration ? { configuration: session.configuration } : {}),
                resolveTarget(ref: string) { return resolveTarget(session, ref); },
                targetLocator(target: string) {
                  const locator = targetLocators.get(target);
                  if (!locator) throw new Error('Target must be resolved before describing its locator');
                  return locator;
                },
                replaceContext(state: PlaywrightStorageState) { return replaceContext(session, state); },
                async invalidateTargets() { checkSession(session); await session.snapshot.invalidate(); checkSession(session); },
                runAction(action: () => Promise<void>) { return runAction(session, action); },
                ...(session.lease!.executeCode ? { executeCode: ((executionOptions) => {
                  checkSession(session);
                  return session.lease!.executeCode!(executionOptions);
                }) as NonNullable<PlaywrightLease['executeCode']> } : {}),
                ...(session.lease!.generateActionCode ? { generateActionCode: session.lease!.generateActionCode } : {}),
                ...(session.lease!.captureTrace ? { captureTrace: session.lease!.captureTrace } : {}),
                ...(session.lease!.prepareFileBytes ? { prepareFileBytes(bytes: Uint8Array) {
                  checkSession(session);
                  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxArtifactBytes || bytes.byteLength > maxCommandBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
                  return session.lease!.prepareFileBytes!(bytes);
                } } : {}),
                ...(session.lease!.captureArtifact ? { captureArtifact: ((produce, captureOptions) => {
                  checkSession(session);
                  return session.lease!.captureArtifact!(produce, { ...captureOptions,
                    signal: AbortSignal.any([local.signal, captureOptions.signal]),
                    maxBytes: Math.min(captureOptions.maxBytes, maxArtifactBytes, maxCommandBytes),
                  });
                }) as NonNullable<PlaywrightLease['captureArtifact']> } : {}),
                async selectPage(page: PlaywrightPage) {
                  checkSession(session);
                  const pages = session.lease!.context.pages();
                  if (!pages.includes(page)) throw new Error('Page does not belong to this session');
                  if (pages.length > maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
                  await selectPage(session, page, () => checkSession(session));
                  session.pages = [...pages];
                },
                registerCleanup(cleanup: () => Promise<void>) {
                  checkSession(session);
                  if (typeof cleanup !== 'function') throw new TypeError('Invalid Playwright session cleanup');
                  session.cleanups.add(cleanup);
                },
              });
            }
            const executeAbility = () => executePlaywrightAbility(ability, parsed, invocation, { signal: local.signal, maxCommandBytes, maxArtifactBytes, commandBudget, actionTimeoutMs: sessionActionTimeout(active), codeExecutionTimeoutMs, navigationTimeoutMs: sessionNavigationTimeout(active), maxPages: maxTabs, ...(browserSession ? { browserSession } : {}), check: () => active ? checkSession(active) : check() });
            let result: void | PlaywrightCommandResult;
            try { result = active ? await active.snapshot.withReferences(executeAbility) : await executeAbility(); }
            catch (error) {
              if (canRetainAfterError(active, error)) retained = true;
              throw error;
            }
            check();
            if (active) {
              if (!active.page || !getPlaywrightModal(active.page)) await Promise.all([...active.pendingActions ?? []]);
              await active.snapshot.invalidate();
              checkSession(active);
              active.pages = [...active.lease!.context.pages()];
              if (active.pages.length > maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
              await checkpoint(active, local.signal);
              if (active.page && getPlaywrightModal(active.page)) result = { sections: [...result?.sections ?? [], ...(await pageResult(active, undefined)).sections] };
              else {
                const downloads = await downloadSections(active);
                if (downloads.length) result = { sections: [...result?.sections ?? [], ...downloads] };
              }
              const traceLinks = await flushTrace(active);
              traceFlushed = true;
              if (traceLinks.length && ['tracing-start', 'tracing-stop'].includes(parsed.command)) {
                const sections = [...result?.sections ?? []];
                const index = sections.findIndex(section => section.title === 'Result');
                if (index === -1) sections.push({ title: 'Result', content: traceLinks.join('\n') });
                else sections[index] = { ...sections[index]!, content: sections[index]!.content + '\n' + traceLinks.join('\n') };
                result = { sections };
              }
            }
            if (result) await writeResult(result);
            retained = true;
            return;
          }
          if (parsed.command === 'close') {
            const session = sessions.get(parsed.session);
            const wasOpen = session?.state === 'open' || (await savedSessions(local.signal)).some(saved => saved.name === parsed.session);
            explicitlyClosed.add(parsed.session);
            const errors: unknown[] = [];
            try { if (session) await retireForCommand(session); } catch (error) { errors.push(error); }
            try { await options.persistence?.close?.(parsed.session, local.signal); } catch (error) { errors.push(error); }
            if (errors.length === 1) throw errors[0];
            if (errors.length) throw new AggregateError(errors, 'Playwright close failed');
            await write(parsed.json ? JSON.stringify({ session: parsed.session, status: wasOpen ? 'closed' : 'not-open' }, null, 2) + '\n'
              : wasOpen ? `Browser '${parsed.session}' closed\n\n` : `Browser '${parsed.session}' is not open.\n`);
            check();
            return;
          }
          if (parsed.command === 'delete-data') {
            const session = sessions.get(parsed.session);
            explicitlyClosed.add(parsed.session);
            const errors: unknown[] = [];
            try { if (session && session.state !== 'closed') await release(session); } catch (error) { errors.push(error); }
            try { await options.persistence?.delete(parsed.session, local.signal); sessions.delete(parsed.session); } catch (error) { errors.push(error); }
            if (errors.length === 1) throw errors[0];
            if (errors.length) throw new AggregateError(errors, 'Playwright retirement and data deletion failed');
            await write(parsed.json ? JSON.stringify({ session: parsed.session, deleted: !!session || !!options.persistence }, null, 2) + '\n'
              : `Deleted user data for browser '${parsed.session}'.\n`);
            check();
            return;
          }
          if (parsed.command === 'open') {
            const openOptions = await resolvePlaywrightOpenOptions(parsed.options, invocation, options.adapter!, Math.min(maxArtifactBytes, maxCommandBytes));
            explicitlyClosed.delete(parsed.session);
            const previous = sessions.get(parsed.session);
            if (previous && previous.state !== 'closed') await retireForCommand(previous);
            // Remote-loss retirement must finish before reusing its capacity.
            if (previous?.releasing) await previous.releasing;
            check();
            // Preflight and reservation are synchronous: another session cannot
            // claim this slot during retirement's asynchronous boundary.
            const occupied = [...sessions.values()].filter(s => s.state !== 'closed').length;
            if (occupied >= maxSessions) throw new PlaywrightResourceLimitError('Playwright session capacity exceeded');
            active = { name: parsed.session, generation: ++generation, state: 'acquiring', snapshot: createSnapshotEngine({ maxSnapshotBytes, maxSnapshotRefs }, () => `e${++refSequence}`), cleanups: new Set(), idleTimeoutMs: openOptions.idleTimeoutMs, contextOptions: openOptions.contextOptions };
            active.configuration = { ...openOptions.configuration, browserName: openOptions.browser, headless: openOptions.headless };
            sessions.set(parsed.session, active);
            const session = active;
            session.lease = await options.adapter!.acquire({ acquisitionId: `playwright-${session.generation}`, session: session.name, browser: openOptions.browser, headless: openOptions.headless, contextOptions: openOptions.contextOptions, signal: local.signal });
            check();
            observeSession(session);
            await initializeContext(session);
            checkSession(session);
            if (session.lease.context.pages().length >= maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
            await selectPage(session, await session.lease.context.newPage(), () => checkSession(session));
            session.pages = [...session.lease.context.pages()];
            checkSession(session);
            if (parsed.url) await runAction(session, async () => { await session.page!.goto(parsed.url!, { timeout: sessionNavigationTimeout(session) }); });
            checkSession(session);
            const result = await pageResult(session, actionCode(session, { name: 'navigate', url: parsed.url ?? 'about:blank' }, `await page.goto(${playwrightCodeString(parsed.url ?? 'about:blank')});`), 'file');
            const rendered = serializePlaywrightResult(configuredResult(result), parsed);
            await write(parsed.json ? JSON.stringify({ session: session.name, result: JSON.parse(rendered) }, null, 2) + '\n'
              : `### Browser \`${session.name}\` opened.\n` + rendered);
            checkSession(session);
            session.state = 'open';
            await checkpoint(session, local.signal);
            retained = true;
          } else {
            const session = sessions.get(parsed.session);
            if (!session || session.state !== 'open') throw new Error(`Session closed: ${parsed.session}; reopen explicitly`);
            active = session;
            if (parsed.command === 'goto') {
              if (!session.page) { retained = true; throw new Error('Selected tab closed; select a tab explicitly'); }
              await session.snapshot.invalidate();
              checkSession(session);
              await runAction(session, async () => { await session.page!.goto(parsed.url!, { timeout: sessionNavigationTimeout(session) }); });
              checkSession(session);
              await writeResult(await pageResult(session, actionCode(session, { name: 'navigate', url: parsed.url! }, `await page.goto(${playwrightCodeString(parsed.url!)});`), 'file'));
              checkSession(session);
              await checkpoint(session, local.signal);
              retained = true;
              return;
            }
            // Preflight failures do not retire an otherwise healthy session.
            retained = true;
            const pages = [...session.lease!.context.pages()];
            if (!session.pages || pages.length !== session.pages.length || pages.some((page, index) => page !== session.pages![index])) await session.snapshot.invalidate();
            session.pages = pages;
            const page = session.page;
            if ((!page || !pages.includes(page)) && !['tab-list', 'tab-new', 'tab-select'].includes(parsed.command) && !(parsed.command === 'tab-close' && parsed.tab !== undefined)) {
              await session.snapshot.invalidate();
              throw new Error('Selected tab closed; select a tab explicitly');
            }
            checkSession(session);
            if (parsed.command === 'config-print') {
              const config = { browser: {
                ...(session.configuration?.browserName ? { browserName: session.configuration.browserName } : {}),
                isolated: true,
                launchOptions: session.configuration?.headless === undefined ? {} : { headless: session.configuration.headless },
                contextOptions: session.contextOptions ?? {},
                ...(session.configuration?.initScriptFiles ? { initScript: session.configuration.initScriptFiles } : {}),
                ...(session.configuration?.initPages ? { initPage: session.configuration.initPages.map(page => page.filename) } : {}),
              }, codegen: session.configuration?.codegen ?? 'typescript',
                timeouts: { action: sessionActionTimeout(session), navigation: sessionNavigationTimeout(session), expect: session.configuration?.timeouts?.expect ?? 5000, settle: session.configuration?.timeouts?.settle ?? 500, idle: session.idleTimeoutMs ?? 0 },
                snapshot: { mode: 'full', ...session.configuration?.snapshot }, skillMode: true,
                ...Object.fromEntries(['network', 'console', 'outputDir', 'outputMaxSize', 'testIdAttribute', 'configFile'].flatMap(key => {
                  const value = session.configuration?.[key as keyof PlaywrightSessionConfiguration]; return value === undefined ? [] : [[key, value]];
                })),
              };
              await writeResult({ sections: [{ title: 'Result', content: { json: config as unknown as import('./response.js').PlaywrightJsonValue } }] });
            } else if (parsed.command === 'tab-list') {
              const tabs = await Promise.all(pages.map(async (tab, index) => `- ${index}:${tab === page ? ' (current)' : ''} [${await tab.title?.() ?? ''}](${tab.url()})`));
              await writeResult({ sections: [{ title: 'Result', content: tabs.join('\n') }] });
            } else if (parsed.command === 'tab-new') {
              if (pages.length >= maxTabs) throw new PlaywrightResourceLimitError('Playwright tab limit exceeded');
              retained = false;
              await session.snapshot.invalidate();
              checkSession(session);
              const tab = await session.lease!.context.newPage();
              await selectPage(session, tab, () => checkSession(session));
              session.pages = [...session.lease!.context.pages()];
              if (parsed.url) await runAction(session, async () => { await tab.goto(parsed.url!, { timeout: sessionNavigationTimeout(session) }); });
              checkSession(session);
              await writeResult(await pageResult(session, 'await page.context().newPage();', 'file'));
            } else if (parsed.command === 'tab-select' || parsed.command === 'tab-close') {
              const index = parsed.tab ?? pages.indexOf(page!);
              const tab = pages[index];
              if (!tab) throw new Error('Unknown tab index');
              retained = false;
              await session.snapshot.invalidate();
              checkSession(session);
              if (parsed.command === 'tab-close') {
                await tab.close();
                checkSession(session);
                session.pages = [...session.lease!.context.pages()];
                const next = tab === page ? session.pages[0] : page;
                if (next) await selectPage(session, next, () => checkSession(session));
                else { session.detachPage?.(); delete session.page; }
              } else await selectPage(session, tab, () => checkSession(session));
              checkSession(session);
              await writeResult(await pageResult(session, parsed.command === 'tab-close' ? `await page.context().pages()[${index}].close();` : undefined, 'file'));
            } else if (parsed.command === 'highlight') {
              const target = parsed.args[0];
              const hide = parsed.options.hide === true;
              if (!target && !hide) throw new Error('Highlight requires a target unless --hide is used');
              const style = parsed.options.style as string | undefined;
              if (!target) {
                if (page!.hideHighlight) await page!.hideHighlight();
                else await updatePlaywrightHighlight(page!, undefined, { hide });
                await writeResult({ sections: [{ title: 'Result', content: 'Hid page highlight' }] });
              } else {
                const handle = await resolveTarget(session, target);
                const isReference = isPlaywrightSnapshotRef(target);
                const selector = isReference ? session.snapshot.nativeSelector(target) : target;
                if (!selector) throw new Error('Native locator generation unavailable for this snapshot');
                const description = await generatedPlaywrightLocator(page!, selector, isReference);
                const locator = page!.locator(isReference ? selector : playwrightLocatorSelector(page!, selector));
                if (page!.hideHighlight && locator.hideHighlight && locator.highlight) {
                  if (hide) await locator.hideHighlight();
                  else await locator.highlight(style === undefined ? {} : { style });
                } else await updatePlaywrightHighlight(page!, handle, { hide, ...(style === undefined ? {} : { style }) });
                await writeResult({ sections: [{ title: 'Result', content: hide ? `Hid highlight for ${description}` : `Highlighted ${description}` }] });
              }
            } else if (parsed.command === 'generate-locator') {
              const target = parsed.args[0]!;
              await resolveTarget(session, target);
              const isReference = isPlaywrightSnapshotRef(target);
              const selector = isReference ? session.snapshot.nativeSelector(target) : target;
              if (!selector) throw new Error('Native locator generation unavailable for this snapshot');
              const result = await generatedPlaywrightLocator(page!, selector, isReference);
              checkSession(session);
              await writeResult({ sections: [{ title: 'Result', content: result }] });
            } else if (parsed.command === 'find') {
              const text = await session.snapshot.capture(page!, local.signal);
              const result = await findPlaywrightSnapshot(text, { page: page!, ...(parsed.args[0] === undefined ? {} : { text: parsed.args[0] }),
                ...(parsed.options.regex === undefined ? {} : { regex: parsed.options.regex as string }),
              });
              checkSession(session);
              await writeResult({ sections: [{ title: 'Result', content: result }] });
            } else if (parsed.command === 'snapshot') {
              if (typeof page!.on !== 'function' || typeof page!.off !== 'function') throw new Error('Snapshot engine unsupported: navigation events required');
              await session.snapshot.withReferences(async () => { await writeResult(await pageResult(session, undefined, 'inline', parsed.filename)); });
            } else if (parsed.command === 'click' || parsed.command === 'fill') {
              const command = parsed.command;
              await session.snapshot.withReferences(async () => {
                const target = await resolveTarget(session, parsed.ref!);
                if (typeof target[command] !== 'function') throw new Error('Snapshot action unsupported');
                checkSession(session);
                retained = false;
                if (command === 'click') await runAction(session, () => target.click({ timeout: sessionActionTimeout(session), ...(parsed.button === 'left' ? {} : { button: parsed.button }), ...(parsed.modifiers?.length ? { modifiers: parsed.modifiers } : {}) }));
                else {
                  await runAction(session, async () => {
                    await target.fill(parsed.value!, { timeout: sessionActionTimeout(session) });
                    if (parsed.options.submit) await page!.keyboard.press('Enter');
                  });
                }
              });
            } else if (parsed.command === 'press') {
              if (typeof page!.keyboard?.press !== 'function') throw new Error('Keyboard press unsupported');
              retained = false;
              await runAction(session, () => page!.keyboard.press(parsed.value!));
            } else if (parsed.command === 'screenshot') {
              const bytes = parsed.ref
                ? await capturePlaywrightTargetScreenshot(await resolveTarget(session, parsed.ref), { type: parsed.imageType, scale: parsed.scale, timeout: sessionActionTimeout(session), maxArtifactBytes, signal: local.signal })
                : await capturePlaywrightScreenshot(page!, { type: parsed.imageType, fullPage: parsed.fullPage, scale: parsed.scale, timeout: sessionActionTimeout(session), maxArtifactBytes, signal: local.signal });
              checkSession(session);
              // Uint8Array constructor copies even when bytes is a Buffer view.
              const filename = parsed.filename ?? capabilityArtifactName(parsed.ref ? 'element' : 'page', parsed.imageType, session.configuration);
              await writeArtifact(new Uint8Array(bytes), filename);
              const label = parsed.ref ? 'element' : parsed.fullPage ? 'full page' : 'viewport';
              const screenshotTarget = parsed.ref ? targetLocators.get(parsed.ref)! : 'page';
              await writeResult({ sections: [
                { title: 'Result', content: `- [Screenshot of ${label}](${filename})` },
                { title: 'Ran Playwright code', content: `await ${screenshotTarget}.screenshot({ path: ${playwrightCodeString(filename)}, type: ${playwrightCodeString(parsed.imageType)},${parsed.imageType === 'jpeg' ? ' quality: 90,' : ''} scale: ${playwrightCodeString(parsed.scale)}${parsed.ref ? '' : `, fullPage: ${parsed.fullPage}`} });`, codeframe: 'js' },
              ] });
            }
            checkSession(session);
            if (parsed.command === 'click' || parsed.command === 'fill' || parsed.command === 'press') {
              const clickOptions = { ...(parsed.button && parsed.button !== 'left' ? { button: parsed.button } : {}), ...(parsed.modifiers?.length ? { modifiers: parsed.modifiers } : {}) };
              const args = parsed.command === 'fill' ? playwrightCodeString(parsed.value!) : Object.keys(clickOptions).length ? JSON.stringify(clickOptions) : '';
              let code = parsed.command === 'press' ? `await page.keyboard.press(${playwrightCodeString(parsed.value!)});`
                : `await ${targetLocators.get(parsed.ref!)}.${parsed.command}(${args});${parsed.command === 'fill' && parsed.options.submit ? `\nawait page.keyboard.press('Enter');` : ''}`;
              if (parsed.command !== 'press' && session.lease?.generateActionCode) {
                const selector = playwrightLocatorSelector(page!, targetLocators.get(parsed.ref!)!.slice('page.'.length));
                if (parsed.command === 'click') {
                  const modifiers = parsed.modifiers ?? [];
                  const mask = (modifiers.includes('Alt') ? 1 : 0) | (modifiers.includes('Control') || modifiers.includes('ControlOrMeta') ? 2 : 0) | (modifiers.includes('Meta') ? 4 : 0) | (modifiers.includes('Shift') ? 8 : 0);
                  code = actionCode(session, { name: 'click', selector, button: parsed.button ?? 'left', modifiers: mask, clickCount: 1 }, code);
                } else {
                  const base = `await ${targetLocators.get(parsed.ref!)}.fill(${args});`;
                  code = actionCode(session, { name: 'fill', selector, text: parsed.value! }, base);
                  if (parsed.options.submit) code += '\n' + actionCode(session, { name: 'press', selector, key: 'Enter', modifiers: 0 }, "await page.keyboard.press('Enter');");
                }
              }
              await writeResult(await pageResult(session, code, 'file'));
            }
            await checkpoint(session, local.signal);
            retained = true;
          }
        })().catch(error => {
          commandFailure = { error };
        });
        let traceFailure: { error: unknown } | undefined;
        try { if (active?.state === 'open' && retained && !traceFlushed) await flushTrace(active); }
        catch (error) { retained = false; traceFailure = { error }; }
        if (paused) {
          delete paused.idlePaused;
          if (paused.state === 'open') {
            paused.expiresAt = Date.now() + paused.idleTimeoutMs!;
            scheduleExpiry(paused);
          }
        }
        // Retirement is part of the session queue. Keep its rejection for
        // shared invocation cleanup so both execution and cleanup causes survive.
        if (active && !retained) await release(active).catch(() => {});
        if (traceFailure) {
          if (commandFailure) throw new AggregateError([commandFailure.error, traceFailure.error], 'Playwright command and trace flush failed');
          throw traceFailure.error;
        }
        if (commandFailure) throw commandFailure.error;
        await enforceOutputBudget();
      });
    };
    const operation = execute();
    work.add(operation);
    let failure: { error: unknown } | undefined;
    try { await operation; }
    catch (error) { failure = { error: invocation.signal.aborted ? invocation.signal.reason : active?.failure ?? error }; }
    finished = true;
    invocation.signal.removeEventListener('abort', abort);
    lifetime.signal.removeEventListener('abort', abort);
    // Preserve execution failure alongside cleanup failure; finally must never
    // replace the former with a repeated rejection from shared cleanup.
    try { await cleanup(); }
    catch (cleanupError) {
      if (failure) throw new AggregateError([failure.error, cleanupError], 'Playwright command and cleanup failed');
      throw cleanupError;
    } finally { work.delete(operation); }
    if (failure) throw failure.error;
  };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    // Install shared completion before notifying potentially reentrant hosts.
    disposal = Promise.resolve().then(async () => {
      const retirements = [...sessions.values()].filter(s => s.lease).map(async session => {
        try { await checkpoint(session, new AbortController().signal, false); }
        finally { await release(session); }
      });
      await Promise.allSettled([...work]);
      const results = await Promise.allSettled(retirements);
      results.push(...await Promise.allSettled([...sessions.values()].map(release)));
      const errors = [...new Set(results.flatMap(result => result.status === 'rejected' ? [result.reason] : []))];
      if (errors.length) throw new AggregateError(errors, 'Playwright disposal failed');
    });
    lifetime.abort(new Error('Playwright controller is disposed'));
    return disposal;
  };
  return { run, dispose, restoreSession: (request: PlaywrightSessionRestoreOptions) => restoreSession(request), inspectSessions };
}
import { PlaywrightResourceLimitError, isPlaywrightResourceLimitError } from './resource-limit.js';
