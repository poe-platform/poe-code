import type { PlaywrightAbilityRequest, RegisteredPlaywrightAbility } from './abilities.js';
import type { PlaywrightPage } from './adapter.js';
import type { ParsedInvocation, PlaywrightInvocation } from './invocation.js';
import type { PlaywrightCommandResult } from './response.js';

function freezeConfiguration<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeConfiguration(child);
    Object.freeze(value);
  }
  return value;
}

export async function executePlaywrightAbility(ability: RegisteredPlaywrightAbility, parsed: ParsedInvocation, invocation: PlaywrightInvocation, context: {
  readonly signal: AbortSignal;
  readonly maxCommandBytes: number;
  readonly maxArtifactBytes: number;
  readonly actionTimeoutMs?: number;
  readonly navigationTimeoutMs?: number;
  readonly maxPages?: number;
  readonly browserSession?: PlaywrightAbilityRequest['browserSession'];
  check(): void;
}): Promise<void | PlaywrightCommandResult> {
  let accepting = true;
  let bytesUsed = 0;
  const pending: Promise<unknown>[] = [];
  const cleanups = new Set<() => Promise<void>>();
  const check = () => {
    context.check();
    if (!accepting) throw new Error('Playwright ability invocation has finished');
  };
  const admitBytes = (bytes: number) => {
    if (bytes > context.maxCommandBytes - bytesUsed) throw new PlaywrightResourceLimitError('Playwright command byte limit exceeded');
    bytesUsed += bytes;
  };
  const track = <Result>(action: () => Promise<Result>): Promise<Result> => {
    const operation = Promise.resolve().then(action);
    pending.push(operation);
    void operation.catch(() => {});
    return operation;
  };
  const filenameCheck = (filename: string) => {
    if (typeof filename !== 'string' || !filename || filename.includes('\0')) throw new TypeError('Invalid virtual artifact filename');
  };
  const browserSession = context.browserSession;
  const request: PlaywrightAbilityRequest = Object.freeze({
    command: parsed.command, session: parsed.session, args: parsed.args, options: parsed.options, signal: context.signal,
    limits: Object.freeze({ maxCommandBytes: context.maxCommandBytes, maxArtifactBytes: context.maxArtifactBytes, actionTimeoutMs: context.actionTimeoutMs ?? 5000, navigationTimeoutMs: context.navigationTimeoutMs ?? 60000, maxPages: context.maxPages ?? 16 }),
    ...(browserSession ? { browserSession: Object.freeze({
      context: browserSession.context,
      page: browserSession.page,
      ...(browserSession.configuration ? { configuration: freezeConfiguration(structuredClone(browserSession.configuration)) } : {}),
      ...(browserSession.generateActionCode ? { generateActionCode: ((options) => {
        check();
        const code = browserSession.generateActionCode!(structuredClone(options));
        check();
        if (typeof code !== 'string') throw new TypeError('Native Playwright generated code must be text');
        admitBytes(new TextEncoder().encode(code).byteLength);
        return code;
      }) as NonNullable<typeof browserSession.generateActionCode> } : {}),
      ...(browserSession.targetLocator ? { targetLocator(target: string) {
        check();
        return browserSession.targetLocator!(target);
      } } : {}),
      ...(browserSession.captureTrace ? { captureTrace: ((traceContext, options) => {
        check();
        return track(() => browserSession.captureTrace!(traceContext, { signal: AbortSignal.any([context.signal, options.signal]), maxBytes: Math.min(options.maxBytes, context.maxArtifactBytes, context.maxCommandBytes) }));
      }) as NonNullable<typeof browserSession.captureTrace> } : {}),
      ...(browserSession.executeCode ? { executeCode: ((options) => {
        check();
        // The lease and runAction own suspended execution across modal commands.
        // Invocation tracking here would wait on the dialog it must first return.
        return browserSession.executeCode!({ ...options,
          signal: AbortSignal.any([context.signal, options.signal]),
          timeoutMs: Math.min(options.timeoutMs, context.actionTimeoutMs ?? 30000),
          maxOutputBytes: Math.min(options.maxOutputBytes, context.maxCommandBytes - bytesUsed),
          maxPages: Math.min(options.maxPages, context.maxPages ?? 16),
        });
      }) as NonNullable<typeof browserSession.executeCode> } : {}),
      resolveTarget(ref: string) {
        check();
        return track(async () => {
          context.check();
          const target = await browserSession.resolveTarget(ref);
          context.check();
          return target;
        });
      },
      selectPage(page: PlaywrightPage) {
        check();
        return track(async () => { context.check(); await browserSession.selectPage(page); context.check(); });
      },
      ...(browserSession.replaceContext ? { replaceContext(state: Parameters<NonNullable<typeof browserSession.replaceContext>>[0]) {
        check();
        return track(async () => { context.check(); await browserSession.replaceContext!(state); context.check(); });
      } } : {}),
      ...(browserSession.invalidateTargets ? { invalidateTargets() {
        check();
        return track(async () => { context.check(); await browserSession.invalidateTargets!(); context.check(); });
      } } : {}),
      ...(browserSession.runAction ? { runAction(action: () => Promise<void>) {
        check();
        return track(async () => { context.check(); await browserSession.runAction!(action); context.check(); });
      } } : {}),
      ...(browserSession.prepareFileBytes ? { prepareFileBytes(bytes: Uint8Array) {
        check();
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > context.maxArtifactBytes || bytes.byteLength > context.maxCommandBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
        return browserSession.prepareFileBytes!(bytes);
      } } : {}),
      ...(browserSession.captureArtifact ? { captureArtifact: ((produce, options) => {
        check();
        const signal = AbortSignal.any([context.signal, options.signal]);
        const maxBytes = Math.min(options.maxBytes, context.maxArtifactBytes, context.maxCommandBytes - bytesUsed);
        return track(async () => {
          context.check();
          const bytes = await browserSession.captureArtifact!(produce, { ...options, signal, maxBytes });
          context.check();
          if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
          return bytes;
        });
      }) as NonNullable<typeof browserSession.captureArtifact> } : {}),
      registerCleanup(cleanup: () => Promise<void>) {
        check();
        if (typeof cleanup !== 'function') throw new TypeError('Invalid Playwright session cleanup');
        browserSession.registerCleanup(cleanup);
      },
    }) } : {}),
    write(text: string) {
      check();
      if (typeof text !== 'string') throw new TypeError('Playwright output must be text');
      if (text.length > context.maxCommandBytes - bytesUsed) throw new PlaywrightResourceLimitError('Playwright command byte limit exceeded');
      admitBytes(new TextEncoder().encode(text).byteLength);
      return track(async () => { context.check(); await invocation.write(text); context.check(); });
    },
    readFile(filename: string) {
      check();
      filenameCheck(filename);
      if (!invocation.readArtifact) throw new Error('Virtual artifact input unsupported');
      return track(async () => {
        context.check();
        const bytes = await invocation.readArtifact!(filename, Math.min(context.maxArtifactBytes, context.maxCommandBytes - bytesUsed));
        if (!(bytes instanceof Uint8Array)) throw new TypeError('Artifact input must return bytes');
        if (bytes.byteLength > context.maxArtifactBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
        admitBytes(bytes.byteLength);
        context.check();
        return new Uint8Array(bytes);
      });
    },
    writeArtifact(bytes: Uint8Array, filename?: string) {
      check();
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Artifact output must be bytes');
      if (bytes.byteLength > context.maxArtifactBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
      if (filename !== undefined) filenameCheck(filename);
      if (!invocation.writeArtifact) throw new Error('Artifact byte destination unsupported');
      admitBytes(bytes.byteLength);
      const owned = new Uint8Array(bytes);
      return track(async () => { context.check(); await invocation.writeArtifact!(owned, filename); context.check(); });
    },
    registerCleanup(cleanup: () => Promise<void>) {
      check();
      if (typeof cleanup !== 'function') throw new TypeError('Invalid Playwright ability cleanup');
      cleanups.add(cleanup);
    },
  });
  const failures: unknown[] = [];
  let result: void | PlaywrightCommandResult = undefined;
  try { context.check(); result = await ability.execute!(request); context.check(); }
  catch (error) { failures.push(error); }
  accepting = false;
  const effects = await Promise.allSettled(pending);
  const retired = await Promise.allSettled([...cleanups].map(cleanup => Promise.resolve().then(cleanup)));
  for (const result of [...effects, ...retired]) if (result.status === 'rejected' && !failures.includes(result.reason)) failures.push(result.reason);
  try { context.check(); }
  catch (error) { if (!failures.includes(error)) failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Playwright ability execution and cleanup failed');
  return result;
}
import { PlaywrightResourceLimitError } from './resource-limit.js';
