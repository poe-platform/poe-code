import type { NativeInvocation, JobBindingOptions, JobSourceAdmission, ProcessContext, EffectStore, createJobBinding } from '@poe-code/remote-execution';
import { captureJobSource, nativeArgvByteLimit, assertJobInvocation, assertNativeProcessView } from '@poe-code/remote-execution';
import type { Discovery } from './types.js';
import type { ImageMagickDiscovery } from './imagemagick.js';

export interface MediaEngineRequest extends ProcessContext {
  command: string;
  args: readonly Uint8Array[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  fs: JobBindingOptions['fs'];
  signal: AbortSignal;
  /** Advisory predictions for transfer planning. Never a complete resource list
   * or an authorization boundary; native late access remains authoritative. */
  discovery?: Discovery | ImageMagickDiscovery;
  registerCleanup?: (cleanup: () => Promise<void>) => void;
}
/** The host binds the supplied scoped filesystem and borrowed IO to its
 * authenticated session. Nothing is recovered from an earlier invocation. */
export function createMediaEngine<Request extends MediaEngineRequest>(options: {
  bind(request: Request): Promise<{
    invocation: Omit<NativeInvocation, 'cwd' | 'originalArgv'>;
    job: Pick<ReturnType<typeof createJobBinding>, 'execute'> & { effects?: Pick<EffectStore, 'inspect'> };
  }>;
}) {
  options = Object.freeze({ ...options });
  return {
    execute(request: Request): Promise<{ exitCode: number }> {
      // Defer acquisition until the synchronous cleanup registration has finished.
      const argv = request.args;
      // Admit each slot before copying it or observing a later slot. An invalid
      // starting process description must not trigger dependency acquisition.
      let args: Uint8Array[];
      let env: Readonly<Record<string, string>>;
      try {
        if (!Array.isArray(argv)) throw new TypeError('Incomplete native argv');
        if (argv.length > nativeArgvByteLimit) throw new TypeError('Native argv limit');
        const argumentCount = argv.length;
        let remaining = nativeArgvByteLimit;
        args = Array.from({ length: argumentCount }, (_, index) => {
          if (!Object.hasOwn(argv, index)) throw new TypeError('Incomplete native argv');
          const arg = argv[index];
          if (!(arg instanceof Uint8Array)) throw new TypeError('Incomplete native argv');
          // Public length/search properties can be replaced on a byte carrier.
          // Budget its intrinsic span before copying or observing another slot;
          // inspect only the owned octets, without speculative caller methods.
          const span = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(arg) as number;
          if (span > 1048576) throw new TypeError('Invalid native octets');
          if (span >= remaining) throw new TypeError('Native argv limit');
          remaining -= span + 1;
          const owned = new Uint8Array(arg);
          if (owned.includes(0)) throw new TypeError('NUL in native argv');
          return owned;
        });
        if (argv.length !== argumentCount) throw new TypeError('Incomplete native argv');
        const exported = request.env;
        if (!exported || typeof exported !== 'object' || Array.isArray(exported))
          throw new TypeError('Invalid native environment');
        env = { ...exported };
      } catch (cause) { return Promise.reject(cause); }
      const cleanups: (() => Promise<void>)[] = [];
      let finalizing = false;
      // Preserve extension capabilities without invoking speculative accessors.
      // Only the process description belongs to synchronous admission; the
      // binder/native adapter decides when to access any additional capability.
      const extensions = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(request))
        .filter(([key]) => !['command', 'args', 'cwd', 'env', 'fs', 'signal', 'registerCleanup'].includes(key)));
      const owned = Object.defineProperties({ command: request.command, cwd: request.cwd,
        fs: request.fs, signal: request.signal, args, env,
        registerCleanup(cleanup: () => Promise<void>) {
          if (finalizing) throw new Error('Media invocation cleanup admission closed');
          cleanups.push(cleanup);
        },
      }, extensions) as unknown as Request;
      const signal = owned.signal;
      const sourceCapability = owned.fs;
      // Admission metadata is retained in this call, before either the caller
      // or the asynchronous binder can replace the source's method table.
      let admittedSource: JobSourceAdmission | undefined;
      try {
        if (sourceCapability && typeof sourceCapability === 'object')
          admittedSource = captureJobSource(sourceCapability);
      } catch (cause) { return Promise.reject(cause); }
      let registered!: () => void;
      let registrationFailed!: (cause: unknown) => void;
      const admission = new Promise<void>((resolve, reject) => {
        registered = resolve;
        registrationFailed = reject;
      });
      const completion = admission.then(async () => {
        let primary: { cause: unknown } | undefined;
        let result: { exitCode: number } | undefined;
        try {
          signal.throwIfAborted();
          if (typeof owned.command !== 'string' || !owned.command || owned.command.includes('\0')
            || new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(owned.command)) !== owned.command)
            throw new TypeError('Invalid native command identity');
          if (!sourceCapability || typeof sourceCapability !== 'object') throw new TypeError('Canonical source capability required');
          if (!owned.cwd.startsWith('/') || owned.cwd.includes('\0') || new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(owned.cwd)) !== owned.cwd) throw new TypeError('Absolute lossless logical cwd required');
          for (const [key, value] of Object.entries(owned.env)) {
            if (!key || key.includes('=') || [key, value].some(text => typeof text !== 'string' || text.includes('\0') || new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(text)) !== text)) throw new TypeError('Invalid native environment');
          }
          const cwd = Array.from(new TextEncoder().encode(owned.cwd));
          const originalArgv = owned.args.map(arg => Array.from(arg));
          assertNativeProcessView(cwd, originalArgv);
          const process = { command: owned.command, cwd: owned.cwd, args: owned.args,
            env: owned.env, exported: { ...owned.env } };
          const bound = await options.bind(owned);
          signal.throwIfAborted();
          // Public binding observations cannot substitute another executor or
          // scratch authority for the capability acquired by this invocation.
          const job = bound.job;
          const execute = job.execute.bind(job);
          const binding = bound.invocation;
          // A structural binder may carry private staging or previous-process
          // properties. Observe only binding metadata; cwd/argv belong to this
          // invocation and never come from the binder's filesystem view.
          const invocation: NativeInvocation = {
            sessionId: binding.sessionId, epoch: binding.epoch, buildId: binding.buildId,
            sourceAuthorityId: binding.sourceAuthorityId, bindingId: binding.bindingId,
            materializationId: binding.materializationId, manifestId: binding.manifestId,
            manifestRevision: binding.manifestRevision, directoryRevision: binding.directoryRevision,
            cwd, originalArgv,
          };
          assertJobInvocation(invocation);
          // The host also retains this request while constructing its native
          // adapter. Require its process view and source to agree with our
          // private admission copies. Binding metadata accessors can change
          // them too; finish observing
          // the acquired binding before checking the process at admission.
          // Replacing them during binding would select another native definition
          // or execute with settings that never passed admission.
          // Environment entries began as owned data properties. Do not invoke
          // replacement accessors during the final comparison: they could alter
          // argv or cwd after those fields have already passed admission.
          const environment = Object.getOwnPropertyDescriptors(process.env);
          const description = Object.getOwnPropertyDescriptors(owned);
          const argumentsView = Object.getOwnPropertyDescriptors(process.args);
          if (Object.entries({ command: process.command, cwd: process.cwd, fs: sourceCapability,
            signal, args: process.args, env: process.env }).some(([key, value]) =>
            !Object.hasOwn(description, key) || !('value' in description[key]) || description[key].value !== value)
            || process.args.length !== originalArgv.length
            || originalArgv.some((arg, index) => {
              const slot = argumentsView[index];
              // Binder-installed getters can mutate cwd or a previously checked
              // argument during comparison. Admit only owned data slots without
              // invoking those getters at the process boundary.
              if (!slot || !('value' in slot) || !(slot.value instanceof Uint8Array)) return true;
              const bytes = new Uint8Array(slot.value);
              return bytes.length !== arg.length || arg.some((byte, offset) => bytes[offset] !== byte);
            })
            || Object.keys(environment).length !== Object.keys(process.exported).length
            || Object.entries(process.exported).some(([key, value]) => !Object.hasOwn(environment, key)
              || !('value' in environment[key]) || environment[key].value !== value || !environment[key].enumerable))
            throw new Error('Media process binding changed');
          signal.throwIfAborted();
          const native = await execute(invocation, signal, sourceCapability, admittedSource);
          signal.throwIfAborted();
          const exitCode = native?.exitCode;
          if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid native exit status');
          result = { exitCode };
        } catch (cause) {
          primary = { cause };
        }
        // Binding acquisition can fail or settle after cancellation. Its owned
        // resources belong to this invocation even without a shell registrar.
        finalizing = true;
        const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) throw new AggregateError([
          ...(primary ? [primary.cause] : []), ...failures.map(result => result.reason),
        ], 'Media invocation cleanup failed', primary);
        if (primary) throw primary.cause;
        return result!;
      });
      try {
        request.registerCleanup?.(async () => { await completion; });
      } catch (cause) {
        // No binding has been acquired. Settle the same barrier a registrar may
        // already have retained, without opening admission after its failure.
        registrationFailed(cause);
        return completion;
      }
      registered();
      return completion;
    },
  };
}
