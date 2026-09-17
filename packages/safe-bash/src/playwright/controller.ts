import type { PlaywrightAdapter, PlaywrightContext, PlaywrightLease, PlaywrightPage } from './adapter.js';
import { createSnapshotEngine } from './snapshot.js';
import { capturePlaywrightScreenshot } from './screenshot.js';
import { parseInvocation, validatePlaywrightSessionName, type PlaywrightInvocation } from './invocation.js';
import { formatPlaywrightHelp } from './help.js';
import { registerPlaywrightAbilities, type PlaywrightAbilities, type PlaywrightAbilityRequest } from './abilities.js';
import { executePlaywrightAbility } from './ability-execution.js';

export interface PlaywrightControllerOptions {
  readonly adapter?: PlaywrightAdapter;
  readonly abilities?: PlaywrightAbilities;
  readonly limits?: { readonly maxSessions?: number; readonly actionTimeoutMs?: number; readonly maxSnapshotBytes?: number; readonly maxSnapshotRefs?: number; readonly maxArtifactBytes?: number; readonly maxTabs?: number; readonly maxCommandBytes?: number };
  /** Billing declarations are separate; reporting/charging is not implemented. */
  readonly billing?: never;
}
export type PlaywrightSessionState = 'acquiring' | 'open' | 'closing' | 'closed';
export interface PlaywrightSessionRestoreOptions {
  readonly name: string;
  readonly expiresAt?: number;
  readonly signal?: AbortSignal;
  acquire(options: { readonly signal: AbortSignal }): Promise<{ readonly lease: PlaywrightLease; readonly selectedPage?: PlaywrightPage | undefined }>;
}
export interface PlaywrightSessionCheckpoint {
  readonly name: string;
  readonly context: PlaywrightContext;
  readonly selectedPage?: PlaywrightPage;
  readonly expiresAt?: number;
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
  unsubscribe?: () => void;
  releasing?: Promise<void>;
  failure?: Error;
  expiresAt?: number;
}

export function createPlaywrightController(options: PlaywrightControllerOptions = {}) {
  if (!options || typeof options !== 'object') throw new TypeError('Invalid Playwright configuration');
  if (options.adapter !== undefined && (!options.adapter || typeof options.adapter.acquire !== 'function')) throw new TypeError('An injected Playwright adapter is required');
  if (Object.keys(options).some(key => !['adapter', 'abilities', 'limits', 'billing'].includes(key))) throw new TypeError('Unsupported Playwright configuration');
  if (options.limits !== undefined && (!options.limits || typeof options.limits !== 'object' || Object.keys(options.limits).some(key => !['maxSessions', 'actionTimeoutMs', 'maxSnapshotBytes', 'maxSnapshotRefs', 'maxArtifactBytes', 'maxTabs', 'maxCommandBytes'].includes(key)))) throw new TypeError('Unsupported Playwright limits');
  if (options.billing !== undefined) throw new Error('Live billing is not implemented');
  const maxSessions = options.limits?.maxSessions ?? 4;
  const actionTimeoutMs = options.limits?.actionTimeoutMs ?? 30_000;
  const maxSnapshotBytes = options.limits?.maxSnapshotBytes ?? 256 * 1024;
  const maxSnapshotRefs = options.limits?.maxSnapshotRefs ?? 1000;
  const maxArtifactBytes = options.limits?.maxArtifactBytes ?? 16 * 1024 * 1024;
  const maxTabs = options.limits?.maxTabs ?? 16;
  const maxCommandBytes = options.limits?.maxCommandBytes ?? 16 * 1024 * 1024;
  const abilities = registerPlaywrightAbilities(options.abilities, options.adapter !== undefined);
  let refSequence = 0;
  for (const value of [maxSessions, actionTimeoutMs, maxSnapshotBytes, maxSnapshotRefs, maxArtifactBytes, maxTabs, maxCommandBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid Playwright limit');
  const sessions = new Map<string, Session>();
  const tails = new Map<string, Promise<void>>();
  const work = new Set<Promise<unknown>>();
  const lifetime = new AbortController();
  let generation = 0;
  let disposal: Promise<void> | undefined;
  const release = (session: Session): Promise<void> => {
    if (session.releasing) return session.releasing;
    session.state = 'closing';
    session.releasing = Promise.resolve().then(async () => {
      try {
        const callbacks = [...session.cleanups];
        session.cleanups.clear();
        const custom = callbacks.map(cleanup => Promise.resolve().then(cleanup));
        const results = await Promise.allSettled([
          Promise.resolve().then(() => session.detachPage?.()), ...custom,
          session.snapshot.invalidate(true), Promise.resolve().then(() => session.unsubscribe?.()),
          Promise.resolve().then(() => session.lease?.release()),
        ]);
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
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
  const enqueue = <T>(name: string, task: () => Promise<T>): Promise<T> => {
    const operation = (tails.get(name) ?? Promise.resolve()).then(task);
    const tail = operation.then(() => {}, () => {});
    tails.set(name, tail);
    void tail.then(() => { if (tails.get(name) === tail) tails.delete(name); });
    return operation;
  };
  const enforceTabLimit = (session: Session) => {
    if (!session.lease || session.releasing || session.lease.context.pages().length <= maxTabs) return;
    session.failure = new Error('Playwright tab limit exceeded');
    void release(session).catch(() => {});
  };
  const selectPage = async (session: Session, page: PlaywrightPage, check: () => void) => {
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
  const observeSession = (session: Session): void => {
    const unsubscribe = session.lease!.onClosed(() => {
      if (sessions.get(session.name) !== session || session.state === 'closed') return;
      delete session.page;
      session.state = 'closed';
      void release(session).catch(() => {});
    });
    session.unsubscribe = unsubscribe;
    if (session.releasing) { unsubscribe(); throw new Error(`Session closed: ${session.name}`); }
    const context = session.lease!.context;
    const onPage = () => enforceTabLimit(session);
    session.cleanups.add(async () => { context.off('page', onPage); });
    context.on('page', onPage);
  };
  const retireExpired = (): Promise<void> | undefined => {
    const now = Date.now();
    const expired = [...sessions.values()].filter(session => session.state === 'open' && session.expiresAt !== undefined && session.expiresAt <= now);
    if (!expired.length) return undefined;
    return Promise.allSettled(expired.map(session => {
      session.failure = new Error(`Session expired: ${session.name}; reopen explicitly`);
      return release(session);
    })).then(results => {
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Playwright expiry cleanup failed');
    });
  };
  const inspectSessions = (): readonly PlaywrightSessionCheckpoint[] => Object.freeze([...sessions.values()]
    .filter(session => session.state === 'open' && (session.expiresAt === undefined || session.expiresAt > Date.now()))
    .map(session => Object.freeze({ name: session.name, context: session.lease!.context,
      ...(session.page === undefined ? {} : { selectedPage: session.page }),
      ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
    })));
  const restoreSession = async (request: PlaywrightSessionRestoreOptions): Promise<void> => {
    if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['name', 'expiresAt', 'signal', 'acquire'].includes(key))
      || typeof request.acquire !== 'function' || request.signal !== undefined && typeof request.signal.throwIfAborted !== 'function') throw new TypeError('Invalid Playwright session restoration');
    validatePlaywrightSessionName(request.name);
    if (request.expiresAt !== undefined && (!Number.isSafeInteger(request.expiresAt) || request.expiresAt < 0)) throw new TypeError('Invalid Playwright session expiry');
    const { name, expiresAt, acquire } = request;
    const signal = request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal;
    const check = () => {
      signal.throwIfAborted();
      if (expiresAt !== undefined && expiresAt <= Date.now()) throw new Error(`Session expired: ${name}; reopen explicitly`);
    };
    check();
    const operation = enqueue(name, async () => {
      check();
      await retireExpired();
      const previous = sessions.get(name);
      if (previous && previous.state !== 'closed') throw new Error(`Session already ${previous.state}: ${name}`);
      if (previous?.releasing) await previous.releasing;
      check();
      if ([...sessions.values()].filter(session => session.state !== 'closed').length >= maxSessions) throw new Error('Playwright session capacity exceeded');
      const epoch = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => String(value).padStart(10, '0')).join('');
      const session: Session = { name, generation: ++generation, state: 'acquiring', cleanups: new Set(),
        snapshot: createSnapshotEngine({ maxSnapshotBytes, maxSnapshotRefs }, () => `e${epoch}${++refSequence}`),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      };
      sessions.set(name, session);
      try {
        const restored = await acquire.call(request, { signal });
        session.lease = restored.lease;
        check();
        if (!session.lease || typeof session.lease.release !== 'function' || typeof session.lease.onClosed !== 'function'
          || !session.lease.context || ['pages', 'newPage', 'close', 'on', 'off'].some(key => typeof Reflect.get(session.lease!.context, key) !== 'function')) throw new TypeError('Invalid restored Playwright lease');
        observeSession(session);
        const pages = [...session.lease.context.pages()];
        if (pages.length > maxTabs) throw new Error('Playwright tab limit exceeded');
        if (restored.selectedPage !== undefined) {
          if (!pages.includes(restored.selectedPage)) throw new Error('Selected tab does not belong to the restored context');
          await selectPage(session, restored.selectedPage, check);
        }
        check();
        if (session.releasing) throw new Error(`Session closed: ${name}`);
        const currentPages = [...session.lease.context.pages()];
        if (currentPages.length > maxTabs) throw new Error('Playwright tab limit exceeded');
        if (restored.selectedPage !== undefined && !currentPages.includes(restored.selectedPage)) throw new Error('Selected tab closed during restoration');
        session.pages = currentPages;
        session.state = 'open';
      } catch (error) {
        const reason = signal.aborted ? signal.reason : error;
        try { await release(session); }
        catch (cleanupError) { throw new AggregateError([reason, cleanupError], 'Playwright restoration and cleanup failed'); }
        throw reason;
      }
    });
    work.add(operation);
    try { await operation; }
    finally { work.delete(operation); }
  };
  const run = async (invocation: PlaywrightInvocation): Promise<void> => {
    if (lifetime.signal.aborted) throw new Error('Playwright controller is disposed');
    const parsed = parseInvocation(invocation, abilities, options.adapter);
    invocation.signal.throwIfAborted();
    const local = new AbortController();
    let active: Session | undefined;
    let retained = false;
    let finished = false;
    let cleanupCompletion: Promise<void> | undefined;
    const cleanup = (): Promise<void> => {
      if (cleanupCompletion) return cleanupCompletion;
      // Install completion before abort dispatch can reenter cleanup.
      cleanupCompletion = Promise.resolve().then(async () => {
        await operation.catch(() => {});
        if (active && (!retained || active.releasing)) await release(active);
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
    const checkSession = (session: Session) => {
      check();
      if (session.expiresAt !== undefined && session.expiresAt <= Date.now()) {
        session.failure = new Error(`Session expired: ${session.name}; reopen explicitly`);
        void release(session).catch(() => {});
      }
      enforceTabLimit(session);
      if (session.releasing) throw session.failure ?? new Error(`Session closed: ${session.name}; reopen explicitly`);
    };
    const execute = async () => {
      check();
      if (parsed.command === 'help') {
        await invocation.write(formatPlaywrightHelp(parsed.topic, abilities));
        check();
        return;
      }
      const ability = abilities.get(parsed.command)!;
      const expiryRetirement = retireExpired();
      if (expiryRetirement) await expiryRetirement;
      check();
      if (parsed.command === 'list' && !ability.execute) {
        await invocation.write([...sessions.values()].map(s => `${s.name}\t${s.state}\n`).join(''));
        check();
        return;
      }
      if (parsed.command === 'close-all' && !ability.execute) {
        const results = await Promise.allSettled([...new Set([...sessions.keys(), ...tails.keys()])].map(name => enqueue(name, async () => {
          check();
          const session = sessions.get(name);
          if (session) await release(session);
        })));
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Playwright close-all failed');
        check();
        return;
      }
      await enqueue(parsed.session, async () => {
        try {
          check();
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
                async resolveTarget(ref: string) { checkSession(session); const target = await session.snapshot.resolve(ref); checkSession(session); return target; },
                async selectPage(page: PlaywrightPage) {
                  checkSession(session);
                  const pages = session.lease!.context.pages();
                  if (!pages.includes(page)) throw new Error('Page does not belong to this session');
                  if (pages.length > maxTabs) throw new Error('Playwright tab limit exceeded');
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
            const executeAbility = () => executePlaywrightAbility(ability, parsed, invocation, { signal: local.signal, maxCommandBytes, maxArtifactBytes, ...(browserSession ? { browserSession } : {}), check: () => active ? checkSession(active) : check() });
            if (active) await active.snapshot.withReferences(executeAbility);
            else await executeAbility();
            check();
            if (active) {
              await active.snapshot.invalidate();
              checkSession(active);
              active.pages = [...active.lease!.context.pages()];
              if (active.pages.length > maxTabs) throw new Error('Playwright tab limit exceeded');
            }
            retained = true;
            return;
          }
          if (parsed.command === 'close') {
            const session = sessions.get(parsed.session);
            if (session) await release(session);
            check();
            return;
          }
          if (parsed.command === 'open') {
            const previous = sessions.get(parsed.session);
            if (previous && previous.state !== 'closed') throw new Error(`Session already ${previous.state}: ${parsed.session}`);
            // Remote-loss retirement must finish before reusing its capacity.
            if (previous?.releasing) await previous.releasing;
            check();
            // Preflight and reservation are synchronous: another session cannot
            // claim this slot during retirement's asynchronous boundary.
            const occupied = [...sessions.values()].filter(s => s.state !== 'closed').length;
            if (occupied >= maxSessions) throw new Error('Playwright session capacity exceeded');
            active = { name: parsed.session, generation: ++generation, state: 'acquiring', snapshot: createSnapshotEngine({ maxSnapshotBytes, maxSnapshotRefs }, () => `e${++refSequence}`), cleanups: new Set() };
            sessions.set(parsed.session, active);
            const session = active;
            session.lease = await options.adapter!.acquire({ acquisitionId: `playwright-${session.generation}`, session: session.name, browser: parsed.browser, headless: parsed.headless, signal: local.signal });
            check();
            observeSession(session);
            checkSession(session);
            if (session.lease.context.pages().length >= maxTabs) throw new Error('Playwright tab limit exceeded');
            await selectPage(session, await session.lease.context.newPage(), () => checkSession(session));
            session.pages = [...session.lease.context.pages()];
            checkSession(session);
            if (parsed.url) await session.page!.goto(parsed.url, { timeout: actionTimeoutMs });
            checkSession(session);
            await invocation.write(`Session ${session.name} open\n`);
            checkSession(session);
            session.state = 'open';
            retained = true;
          } else {
            const session = sessions.get(parsed.session);
            if (!session || session.state !== 'open') throw new Error(`Session closed: ${parsed.session}; reopen explicitly`);
            active = session;
            if (parsed.command === 'goto') {
              if (!session.page) { retained = true; throw new Error('Selected tab closed; select a tab explicitly'); }
              await session.snapshot.invalidate();
              checkSession(session);
              await session.page.goto(parsed.url!, { timeout: actionTimeoutMs });
              checkSession(session);
              await invocation.write(`Session ${session.name} navigated\n`);
              checkSession(session);
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
            if (parsed.command === 'tab-list') {
              await invocation.write(pages.map((tab, index) => `${index}\t${tab === page ? 'selected' : 'open'}\t${JSON.stringify(tab.url())}\n`).join(''));
            } else if (parsed.command === 'tab-new') {
              if (pages.length >= maxTabs) throw new Error('Playwright tab limit exceeded');
              retained = false;
              await session.snapshot.invalidate();
              checkSession(session);
              const tab = await session.lease!.context.newPage();
              await selectPage(session, tab, () => checkSession(session));
              session.pages = [...session.lease!.context.pages()];
              if (parsed.url) await tab.goto(parsed.url, { timeout: actionTimeoutMs });
              checkSession(session);
              await invocation.write(`Tab ${session.pages.indexOf(tab)} selected\n`);
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
              await invocation.write(`Tab ${index} ${parsed.command === 'tab-close' ? 'closed' : 'selected'}\n`);
            } else if (parsed.command === 'snapshot') {
              if (typeof page!.on !== 'function' || typeof page!.off !== 'function') throw new Error('Snapshot engine unsupported: navigation events required');
              const text = await session.snapshot.capture(page!, local.signal);
              checkSession(session);
              if (parsed.filename !== undefined) {
                const bytes = new TextEncoder().encode(text);
                if (bytes.byteLength > maxArtifactBytes) throw new Error('Artifact byte limit exceeded');
                await invocation.writeArtifact!(bytes, parsed.filename);
              } else await invocation.write(text);
            } else if (parsed.command === 'click' || parsed.command === 'fill') {
              const command = parsed.command;
              await session.snapshot.withReferences(async () => {
                const target = await session.snapshot.resolve(parsed.ref!);
                if (typeof target[command] !== 'function') throw new Error('Snapshot action unsupported');
                checkSession(session);
                retained = false;
                if (command === 'click') await target.click({ timeout: actionTimeoutMs });
                else await target.fill(parsed.value!, { timeout: actionTimeoutMs });
              });
            } else if (parsed.command === 'press') {
              if (typeof page!.keyboard?.press !== 'function') throw new Error('Keyboard press unsupported');
              retained = false;
              await page!.keyboard.press(parsed.value!);
            } else if (parsed.command === 'screenshot') {
              const bytes = await capturePlaywrightScreenshot(page!, { type: parsed.imageType, fullPage: parsed.fullPage, timeout: actionTimeoutMs, maxArtifactBytes, signal: local.signal });
              checkSession(session);
              // Uint8Array constructor copies even when bytes is a Buffer view.
              await invocation.writeArtifact!(new Uint8Array(bytes), parsed.filename);
            }
            checkSession(session);
            retained = true;
          }
        } finally {
          // Retirement is part of the session queue. Keep its rejection for
          // shared invocation cleanup so both execution and cleanup causes survive.
          if (active && !retained) await release(active).catch(() => {});
        }
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
      const retirements = [...sessions.values()].filter(s => s.lease).map(release);
      await Promise.allSettled([...work]);
      const results = await Promise.allSettled([...retirements, ...[...sessions.values()].map(release)]);
      const errors = [...new Set(results.flatMap(result => result.status === 'rejected' ? [result.reason] : []))];
      if (errors.length) throw new AggregateError(errors, 'Playwright disposal failed');
    });
    lifetime.abort(new Error('Playwright controller is disposed'));
    return disposal;
  };
  return { run, dispose, restoreSession, inspectSessions };
}
