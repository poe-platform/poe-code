import {createCsvpyInterpreter} from "./csvpy-interpreter.js";
import { utf8Codec } from "./codecs/utf8.js";
import { pythonCodecs } from "./codecs/python.js";
import { databases as databaseDialects } from "./databases.js";
import { defaultSniffStreamProfile } from "./csv/sniffer-profile.js";
import { createGzipCompressionProvider } from "./io/compression.js";
import { createCompressionCodec } from "@poe-code/compression";
import { createDefaultSqliteDatabaseProvider } from "./default-sqlite.js";
import { portableLocale } from "./portable-locale.js";
import { commands } from "./commands.js";
import { execute, resolveCsvkitLimits, type CsvkitLimitOptions } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { LazyInput, virtualPath } from "./io/index.js";
import { CsvkitBlocked, CsvkitCleanupError } from "./errors.js";
import type { CsvkitContext } from "./contracts.js";
import { createOutputOperation, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { writeFileOutput, openFileOutput } from "safe-bash-contracts/filesystem-output";
import { FsError, isFsError } from "safe-bash-contracts/errors";
import { shellValueByteLength } from "safe-bash-contracts/value";

import { evalSyncCsvlook, evalSyncCsvjson, evalSyncCsvsort, evalSyncCsvformat, evalSyncCsvstat, evalSyncIn2csv, evalSyncCsvstack, evalSyncCsvjoin } from "./sync.js";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "safe-bash-contracts/runtime-control";

function isDefaultCsvkitOptions(options?: CsvkitCommandsOptions): boolean {
  if (!options) return true;
  return (
    options.limits === undefined &&
    options.codecs === undefined &&
    options.locale === undefined &&
    options.clock === undefined &&
    options.terminal === undefined &&
    options.compression === undefined &&
    options.databases === undefined &&
    options.sqlDialects === undefined &&
    options.interpreter === undefined &&
    options.openMatchFile === undefined &&
    options.sniffing === undefined &&
    options.columnWarnings === undefined &&
    options.probeInputOpen === undefined
  );
}

/** Portable defaults; hosts may inject codecs, locale, clock and terminal. */
export interface CsvkitCommandsOptions extends Partial<Pick<CsvkitContext, "codecs" | "locale" | "clock" | "terminal">> {
  readonly compression?: CsvkitContext["compression"];
  readonly databases?: CsvkitContext["databases"];
  readonly sqlDialects?: CsvkitContext["sqlDialects"];
  readonly interpreter?: CsvkitContext["interpreter"];
  readonly openMatchFile?: CsvkitContext["openMatchFile"];
  readonly sniffing?: CsvkitContext["sniffing"];
  readonly columnWarnings?: CsvkitContext["columnWarnings"];
  readonly probeInputOpen?: CsvkitContext["probeInputOpen"];
  readonly limits?: CsvkitLimitOptions;
  readonly replace?: boolean;
}

export function createCsvkitCommands(options: CsvkitCommandsOptions = {}): readonly CommandDefinition[] {
  if (options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("csvkit replace must be boolean");
  const limits = resolveCsvkitLimits(options.limits);
  const codecs = Object.freeze([...(options.codecs ?? [utf8Codec, ...pythonCodecs])]);
  const compression = Object.freeze([...(options.compression ?? [createGzipCompressionProvider(createCompressionCodec())])]);
  const clock = options.clock ?? { now: Date.now };
  const sqliteLimits = Object.freeze({maxWork: limits.maxWork, maxSqlBytes: limits.maxRetainedBytes, maxValueBytes: limits.maxRetainedBytes, maxResultRows: limits.maxDatabaseResultRows});
  const databases = Object.freeze([...(options.databases ?? [createDefaultSqliteDatabaseProvider(clock, sqliteLimits)])]);
  const sqlDialects = Object.freeze([...(options.sqlDialects ?? databaseDialects)]);
  const locale = options.locale ?? portableLocale;
  const interpreter = options.interpreter, openMatchFile = options.openMatchFile;
  const terminal = Object.freeze({ stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24, ...options.terminal });
  const sniffing = options.sniffing === undefined ? Object.freeze({ stream: defaultSniffStreamProfile, suppressWarnings: true }) : Object.freeze({
    ...options.sniffing,
    ...(options.sniffing.warning === undefined ? {} : { warning: Object.freeze({ ...options.sniffing.warning }) })
  });
  const columnWarnings = options.columnWarnings === undefined ? Object.freeze({ suppressWarnings: true }) : Object.freeze({ ...options.columnWarnings });
  const probeInputOpen = options.probeInputOpen;
  const definitions = Object.freeze(commands.map<CommandDefinition>(descriptor => ({
    name: descriptor.name,
    ...(descriptor.name === "csvcut" || descriptor.name === "csvgrep" ? { fallback: true } : {}),
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
          if (inputBytes > limits.maxInputBytes) throw new CsvkitBlocked("input byte budget exceeded");
          return bytes;
        };
        const fsAdapter: CsvkitContext["fs"] = {
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
          };
        const invocationDatabases = options.databases !== undefined
          ? databases
          : Object.freeze([createDefaultSqliteDatabaseProvider(clock, sqliteLimits, { readFile: fsAdapter.readFile, writeFile: fsAdapter.writeFile, maxBytes: limits.maxRetainedBytes })]);
        result = await execute(descriptor.name, {
          argv,
          cwd: context.cwd,
          fs: fsAdapter,
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
          codecs, compression, locale, clock, databases: invocationDatabases,
          sqlDialects,
          interpreter: interpreter ?? createCsvpyInterpreter({stdin: context.stdin, admitInput: account}),
          openMatchFile: openMatchFile ?? (async (path, settings) => {
            const resolved = virtualPath(settings.cwd, path);
            await context.fs.stat(resolved, { signal: settings.signal });
            settings.signal.throwIfAborted();
            const source = context.fs.readStream
              ? context.fs.readStream(resolved, { signal: settings.signal })
              : (async function* () { yield await context.fs.readFile(resolved, { signal: settings.signal, ...(Number.isFinite(limits.maxInputBytes) ? { maxBytes: limits.maxInputBytes } : {}) }); })();
            let retained = 0, work = 0, codepoints = 0;
            const file = new LazyInput(path, () => (async function* () {
              for await (const bytes of source) {
                yield account(bytes);
              }
            })(), utf8Codec, "utf-8", settings.signal, bytes => {
              retained += bytes;
              if (retained > limits.maxRetainedBytes) throw new CsvkitBlocked("retained byte budget exceeded");
            }, text => {
              work += text.length;
              if (work > limits.maxWork) throw new CsvkitBlocked("work budget exceeded");
              for (const char of text) { void char; if (++codepoints > limits.maxCodepoints) throw new CsvkitBlocked("codepoint budget exceeded"); }
            }, false);
            return { lines: () => file.lines(), close: () => file.close() };
          }),
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
  Object.assign(syncCommandEvaluators, { evalSyncCsvlook, evalSyncCsvjson, evalSyncCsvsort, evalSyncCsvformat, evalSyncCsvstat, evalSyncIn2csv, evalSyncCsvstack, evalSyncCsvjoin });
  if (isDefaultCsvkitOptions(options)) {
    for (const definition of definitions) builtInDirectContextExecutors.add(definition.execute);
  }
  return definitions;
}

/** Explicit opt-in, with all-name collision preflight before any registration. */
export function csvkitCommands(options: CsvkitCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createCsvkitCommands(options);
  const replace = options.replace ?? false;
  return { name: "csvkit-commands", setup(host) {
    if (!replace) for (const definition of definitions) if (host.commands.has(definition.name) && !(definition.fallback && !host.commands.get(definition.name)?.fallback)) throw new Error(`Command already registered: ${definition.name}`);
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}

/** Select one csvkit command; csvclean is the family default. */
export function createCsvkitCommand(options: CsvkitCommandsOptions & { readonly name?: string } = {}): CommandDefinition {
  const name = options.name ?? "csvclean";
  const command = createCsvkitCommands(options).find(command => command.name === name);
  if (!command) throw new TypeError(`Unknown csvkit command: ${name}`);
  return command;
}
