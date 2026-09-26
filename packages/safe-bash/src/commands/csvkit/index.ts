import { commands, execute, OwnedArguments, defaultLimits, virtualPath, CsvkitCleanupError, type CsvkitContext, type CsvkitLimits } from "safe-bash-command-csvkit";
import { createOutputOperation, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { writeFileOutput, openFileOutput } from "../../contracts/filesystem-output.js";
import { FsError, isFsError } from "../../contracts/errors.js";
import { shellValueByteLength } from "../../contracts/value.js";

/** Hosts bind locale, codecs, clock and terminal explicitly; no ambient I/O or drivers. */
export interface CsvkitCommandsOptions extends Pick<CsvkitContext, "codecs" | "locale" | "clock" | "terminal"> {
  readonly compression?: CsvkitContext["compression"];
  readonly databases?: CsvkitContext["databases"];
  readonly sqlDialects?: CsvkitContext["sqlDialects"];
  readonly interpreter?: CsvkitContext["interpreter"];
  readonly openMatchFile?: CsvkitContext["openMatchFile"];
  readonly sniffing?: CsvkitContext["sniffing"];
  readonly columnWarnings?: CsvkitContext["columnWarnings"];
  readonly probeInputOpen?: CsvkitContext["probeInputOpen"];
  readonly limits?: Partial<CsvkitLimits>;
  readonly replace?: boolean;
}

export function createCsvkitCommands(options: CsvkitCommandsOptions): readonly CommandDefinition[] {
  if (!options || !Array.isArray(options.codecs) || !options.locale || !options.clock || !options.terminal)
    throw new TypeError("csvkit requires explicit codec, locale, clock and terminal bindings");
  if (options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("csvkit replace must be boolean");
  const limits = Object.freeze({ ...defaultLimits, ...options.limits });
  const codecs = Object.freeze([...options.codecs]);
  const compression = Object.freeze([...(options.compression ?? [])]);
  const databases = Object.freeze([...(options.databases ?? [])]);
  const sqlDialects = Object.freeze([...(options.sqlDialects ?? [])]);
  const locale = options.locale, clock = options.clock, interpreter = options.interpreter, openMatchFile = options.openMatchFile;
  const terminal = Object.freeze({ ...options.terminal });
  const sniffing = options.sniffing === undefined ? undefined : Object.freeze({
    ...options.sniffing,
    ...(options.sniffing.warning === undefined ? {} : { warning: Object.freeze({ ...options.sniffing.warning }) })
  });
  const columnWarnings = options.columnWarnings === undefined ? undefined : Object.freeze({ ...options.columnWarnings });
  const probeInputOpen = options.probeInputOpen;
  return Object.freeze(commands.map<CommandDefinition>(descriptor => ({
    name: descriptor.name,
    description: `csvkit 2.2.0 ${descriptor.name}; compatibility gaps return status 78`,
    async execute(context) {
      // Parser and named-file diagnostics can use stderr without acquiring stdout.
      // Enroll stream cleanup only once reading stdin or writing stdout begins.
      let stdout: ReturnType<typeof createOutputOperation> | undefined;
      const cleanups: (() => Promise<void>)[] = [];
      const stdoutCleanups: (() => Promise<void>)[] = [];
      const output = () => {
        if (!stdout) {
          stdout = createOutputOperation(context, context.stdout);
          if (!stdout.signal.aborted) for (const cleanup of stdoutCleanups) stdout.registerCleanup(cleanup);
        }
        return stdout;
      };
      let completed = false;
      let executionFailed = false;
      let result: number | undefined;
      let failure: unknown;
      try {
        const carrier = getCommandArguments(context);
        let argumentBytes = 0;
        for (const value of carrier.values.length > limits.maxArguments ? [] : carrier.values) {
          argumentBytes += shellValueByteLength(value);
          if (!Number.isSafeInteger(argumentBytes) || argumentBytes > limits.maxArgumentBytes) break;
        }
        // Let the shared engine report policy denial before any payload copies.
        const argv = carrier.values.length > limits.maxArguments || argumentBytes > limits.maxArgumentBytes || !Number.isSafeInteger(argumentBytes)
          ? { length: carrier.values.length, byteLength: argumentBytes, bytes: () => { throw new Error("denied argv payload read"); } }
          : new OwnedArguments(carrier.args.map((_, index) => carrier.bytes(index)!), limits);
        let inputBytes = 0;
        const account = (bytes: Uint8Array): Uint8Array => {
          inputBytes += bytes.byteLength;
          context.inputBudget?.check(inputBytes);
          return bytes;
        };
        result = await execute(descriptor.name, {
          argv,
          cwd: context.cwd,
          fs: {
            exists: async (path, settings) => {
              try { await context.fs.stat(path, settings); settings.signal.throwIfAborted(); return true; }
              catch (failure) { settings.signal.throwIfAborted(); if (isFsError(failure)) return false; throw failure; }
            },
            listDirectory: async (path, settings) => (await context.fs.readdir(path, settings)).map(entry => entry.name),
            readFile: async (path, settings) => {
              const maxBytes = Math.min(settings.maxBytes ?? limits.maxInputBytes, limits.maxInputBytes);
              return account(await context.fs.readFile(path, Number.isFinite(maxBytes) ? { ...settings, maxBytes } : { signal: settings.signal }));
            },
            ...(context.fs.readStream === undefined ? {} : {
              readStream(path: string, settings: { readonly signal: AbortSignal }) {
                return { [Symbol.asyncIterator]() {
                  settings.signal.throwIfAborted();
                  const iterator = context.fs.readStream!(path, settings)[Symbol.asyncIterator]();
                  let closing: Promise<void> | undefined;
                  // Runtime enrolls this iterator in its registered cleanup. A
                  // direct return can release a pending cooperative next(); an
                  // async-generator return would queue behind that same next().
                  const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => { await iterator.return?.(); });
                  return {
                    async next() {
                      try {
                        settings.signal.throwIfAborted();
                        if (closing) return { done: true as const, value: undefined };
                        const next = await iterator.next();
                        settings.signal.throwIfAborted();
                        if (next.done) await close();
                        return next.done ? next : { done: false as const, value: account(next.value) };
                      } catch (failure) {
                        await close().catch(() => {});
                        throw failure;
                      }
                    },
                    async return() { await close(); return { done: true as const, value: undefined }; }
                  };
                } };
              }
            }),
            writeFile: async (path, bytes, settings) => writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, settings)),
            ...(context.fs.open === undefined ? {} : { async openWriteFile(path: string, settings: { readonly signal: AbortSignal }) {
              settings.signal.throwIfAborted();
              const capabilities = await context.fs.capabilitiesFor?.(path, { signal: settings.signal, create: true }) ?? context.fs.capabilities;
              settings.signal.throwIfAborted();
              const file = await openFileOutput({ ...context, signal: settings.signal }, path, { flag: "w", descriptor: capabilities.open !== false });
              return { write: file.sink.write.bind(file.sink), close: file.finish.bind(file) };
            } })
          },
          stdin: { [Symbol.asyncIterator]() {
            const operation = output();
            operation.signal.throwIfAborted();
            const iterator = context.stdin[Symbol.asyncIterator]();
            return {
              async next() {
                operation.signal.throwIfAborted();
                const next = await iterator.next();
                operation.signal.throwIfAborted();
                return next.done ? next : { done: false as const, value: account(next.value) };
              },
              ...(iterator.return === undefined ? {} : { return: iterator.return.bind(iterator) })
            };
          } },
          stdinIsDefault: context.stdinIsDefault ?? false,
          stdout: { write: bytes => output().output.write(bytes) }, stderr: context.stderr, terminal, env: Object.freeze({ ...context.env }),
          codecs, compression, locale, clock, databases,
          sqlDialects,
          ...(interpreter === undefined ? {} : { interpreter }),
          ...(openMatchFile === undefined ? {} : { openMatchFile }),
          ...(sniffing === undefined ? {} : { sniffing }),
          ...(columnWarnings === undefined ? {} : { columnWarnings }),
          ...(probeInputOpen ? { probeInputOpen } : {
            async probeInputOpen(path, settings) {
              settings.signal.throwIfAborted();
              const inputPath = virtualPath(settings.cwd, path);
              const capabilities = await context.fs.capabilitiesFor?.(inputPath, { signal: settings.signal }) ?? context.fs.capabilities;
              settings.signal.throwIfAborted();
              const descriptor = context.fs.open !== undefined && capabilities.open !== false;
              let iterator: AsyncIterator<Uint8Array> | undefined;
              let closing: Promise<void> | undefined;
              const close = () => closing ??= Promise.resolve().then(async () => {
                let descriptor;
                try { descriptor = await pending; } catch { return; }
                await descriptor?.close();
              });
              // Enroll before acquiring; late descriptors and bounded readers
              // are both drained before public settlement.
              // The probe's finally always observes close failures, and the
              // engine reports them as named-file diagnostics. The registered
              // barrier must drain the same close without reporting it again.
              const cleanup = async () => { await close().catch(() => {}); };
              cleanups.push(cleanup);
              context.registerCleanup?.(cleanup);
              if (stdout) stdout.registerCleanup(cleanup);
              settings.signal.throwIfAborted();
              const pending = Promise.resolve().then(async () => {
                settings.signal.throwIfAborted();
                if (descriptor) return context.fs.open!(inputPath, { access: "read", creation: "never", signal: settings.signal });
                const stat = await context.fs.stat(inputPath, { signal: settings.signal });
                settings.signal.throwIfAborted();
                if (stat.type === "directory") throw new FsError("EISDIR", { path: inputPath });
                if (capabilities.read === false) throw new FsError("ENOTSUP", { path: inputPath });
                if (context.fs.readStream && capabilities.streamingRead !== false) {
                  iterator = context.fs.readStream(inputPath, { signal: settings.signal, endExclusive: 1, chunkSize: 1 })[Symbol.asyncIterator]();
                  return { async close() { await iterator!.return?.(); } };
                }
                if (capabilities.access === false) throw new FsError("ENOTSUP", { path: inputPath });
                await context.fs.access(inputPath, 4, { signal: settings.signal });
                return undefined;
              });
              try {
                await pending;
                settings.signal.throwIfAborted();
                if (iterator && !closing) await iterator.next();
                settings.signal.throwIfAborted();
              }
              finally { await close(); }
            }
          }),
          limits: { ...limits, maxInputBytes: Math.min(limits.maxInputBytes, context.inputBudget?.maxBytes ?? limits.maxInputBytes) },
          signal: context.signal, registerCleanup: (cleanup, destination) => {
            let closing: Promise<void> | undefined;
            const close = () => closing ??= Promise.resolve().then(async () => {
              try { await cleanup(); }
              catch (cleanupFailure) {
                if (!executionFailed && !context.signal.aborted && !stdout?.signal.aborted) throw cleanupFailure;
              }
            });
            context.registerCleanup?.(close);
            cleanups.push(close);
            if (destination !== "invocation") {
              stdoutCleanups.push(close);
              if (stdout && !stdout.signal.aborted) stdout.registerCleanup(close);
            }
          }
        });
        completed = true;
      } catch (caught) { executionFailed = !(caught instanceof CsvkitCleanupError); failure = caught; }
      const cleanupResults = await Promise.allSettled([...cleanups.map(cleanup => cleanup()), ...(stdout ? [stdout.close()] : [])]);
      context.signal.throwIfAborted();
      stdout?.signal.throwIfAborted();
      if (completed) {
        const failures = cleanupResults.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "CSV invocation cleanup failed");
      }
      if (!completed) throw failure;
      return { exitCode: result! };
    }
  })));
}

/** Explicit opt-in, with all-name collision preflight before any registration. */
export function csvkitCommands(options: CsvkitCommandsOptions): VirtualShellPlugin {
  const definitions = createCsvkitCommands(options);
  const replace = options.replace ?? false;
  return { name: "csvkit-commands", setup(host) {
    if (!replace) for (const definition of definitions) if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}
