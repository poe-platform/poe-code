import type { PlaywrightAbilityRequest, RegisteredPlaywrightAbility } from './abilities.js';
import type { PlaywrightPage } from './adapter.js';
import type { ParsedInvocation, PlaywrightInvocation } from './invocation.js';

export async function executePlaywrightAbility(ability: RegisteredPlaywrightAbility, parsed: ParsedInvocation, invocation: PlaywrightInvocation, context: {
  readonly signal: AbortSignal;
  readonly maxCommandBytes: number;
  readonly maxArtifactBytes: number;
  readonly browserSession?: PlaywrightAbilityRequest['browserSession'];
  check(): void;
}): Promise<void> {
  let accepting = true;
  let bytesUsed = 0;
  const pending: Promise<unknown>[] = [];
  const cleanups = new Set<() => Promise<void>>();
  const check = () => {
    context.check();
    if (!accepting) throw new Error('Playwright ability invocation has finished');
  };
  const admitBytes = (bytes: number) => {
    if (bytes > context.maxCommandBytes - bytesUsed) throw new Error('Playwright command byte limit exceeded');
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
    ...(browserSession ? { browserSession: Object.freeze({
      context: browserSession.context,
      page: browserSession.page,
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
      registerCleanup(cleanup: () => Promise<void>) {
        check();
        if (typeof cleanup !== 'function') throw new TypeError('Invalid Playwright session cleanup');
        browserSession.registerCleanup(cleanup);
      },
    }) } : {}),
    write(text: string) {
      check();
      if (typeof text !== 'string') throw new TypeError('Playwright output must be text');
      if (text.length > context.maxCommandBytes - bytesUsed) throw new Error('Playwright command byte limit exceeded');
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
        if (bytes.byteLength > context.maxArtifactBytes) throw new Error('Artifact byte limit exceeded');
        admitBytes(bytes.byteLength);
        context.check();
        return new Uint8Array(bytes);
      });
    },
    writeArtifact(bytes: Uint8Array, filename?: string) {
      check();
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Artifact output must be bytes');
      if (bytes.byteLength > context.maxArtifactBytes) throw new Error('Artifact byte limit exceeded');
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
  try { context.check(); await ability.execute!(request); context.check(); }
  catch (error) { failures.push(error); }
  accepting = false;
  const effects = await Promise.allSettled(pending);
  const retired = await Promise.allSettled([...cleanups].map(cleanup => Promise.resolve().then(cleanup)));
  for (const result of [...effects, ...retired]) if (result.status === 'rejected' && !failures.includes(result.reason)) failures.push(result.reason);
  try { context.check(); }
  catch (error) { if (!failures.includes(error)) failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Playwright ability execution and cleanup failed');
}
