import type { CsvkitContext, CsvkitLimits } from "./contracts.js";
import { commands } from "./commands.js";
import { parseArguments } from "./cli/parser.js";
import { MatchFileScope } from "./match-files.js";
import { Runtime } from "./runtime.js";
import { CsvkitDiagnostic, CsvkitBlocked, CsvkitCleanupError, CsvkitOutputBudgetError, CsvkitWorkBudgetError } from "./errors.js";
import { commandDefaults, freezeDescriptor, type CommandDescriptor } from "./descriptor.js";
import type { ParseResult } from "./cli/parser.js";
import { diagnosticReport } from "./diagnostics/index.js";
import type { CsvkitRequest } from './sdk-settings.js';
import { SettingsAdmission } from './settings-admission.js';
export type { CsvkitRequest } from './sdk-settings.js';

export type InvocationContext = Omit<CsvkitContext, "argv">;

export const defaultLimits: CsvkitLimits = Object.freeze({
  maxArguments: Infinity, maxArgumentBytes: Infinity,
  maxInputBytes: Infinity, maxOutputBytes: Infinity,
  maxRetainedBytes: Infinity, maxCodepoints: Infinity,
  maxRows: Infinity, maxColumns: Infinity, maxFieldCharacters: Infinity,
  maxWork: Infinity, maxRegexWork: Infinity, maxDecimalDigits: Infinity,
  maxDecimalExponent: Infinity, maxArchiveMembers: Infinity, maxInflatedBytes: Infinity,
  maxDatabaseResultRows: Infinity, maxInterpreterWork: Infinity, maxNestingDepth: Infinity
});

function admitted(context: InvocationContext): InvocationContext {
  context.signal.throwIfAborted();
  const limits = { ...defaultLimits };
  for (const name of Object.keys(defaultLimits)) {
    const key = name as keyof CsvkitLimits;
    const limit = context.limits[key];
    if ((limit !== Infinity && !Number.isSafeInteger(limit)) || limit < 0) throw new RangeError(`invalid csvkit limit ${name}`);
    limits[key] = limit;
  }
  return Object.freeze({ ...context,
    limits: Object.freeze(limits), env: Object.freeze({ ...context.env }),
    terminal: Object.freeze({ ...context.terminal }),
    codecs: Object.freeze([...context.codecs]), compression: Object.freeze([...context.compression]),
    databases: Object.freeze([...context.databases]),
    ...(context.sqlDialects === undefined ? {} : { sqlDialects: Object.freeze(context.sqlDialects.map(dialect => freezeDescriptor({
      ...dialect, reserved: [...dialect.reserved], illegalInitial: [...dialect.illegalInitial],
      ...(dialect.typedTypes === undefined ? {} : { typedTypes: { ...dialect.typedTypes } })
    }))) })
  });
}

/** Original executable argv and SDK calls share this engine; no ambient capabilities. */
export async function execute(command: string, supplied: CsvkitContext): Promise<number> {
  const context = admitted(supplied);
  const descriptor = commands.find(item => item.name === command);
  if (!descriptor) throw new TypeError(`Unknown csvkit executable: ${command}`);
  let parsed: ParseResult;
  try {
    if (supplied.argv.length > context.limits.maxArguments) throw new CsvkitBlocked("argv count limit exceeded");
    if (!Number.isSafeInteger(supplied.argv.byteLength) || supplied.argv.byteLength > context.limits.maxArgumentBytes) throw new CsvkitBlocked("argv byte limit exceeded");
    parsed = await parseArguments(command, Array.from({ length: supplied.argv.length }, (_, index) => supplied.argv.bytes(index)!), {
      limits: context.limits, signal: context.signal, registerCleanup: context.registerCleanup, env: context.env,
      ...(context.openMatchFile === undefined ? {} : {
        openMatchFile: (path: string) => context.openMatchFile!(path, { cwd: context.cwd, signal: context.signal })
      })
    });
  } catch (failure) {
    if (!(failure instanceof CsvkitBlocked)) throw failure;
    return perform(descriptor, { kind: "blocked", failure }, context);
  }
  return perform(descriptor, parsed, context);
}

/** Typed settings reach the operation directly, without reconstructing CLI arguments. */
export async function run(request: CsvkitRequest, supplied: InvocationContext): Promise<number> {
  const context = admitted(supplied);
  const descriptor = commands.find(item => item.name === request.command);
  if (!descriptor) throw new TypeError(`Unknown csvkit executable: ${request.command}`);
  const options = commandDefaults(descriptor, context.env);
  const settings = Object.entries(request.settings ?? {});
  let files: MatchFileScope | undefined;
  const admission = new SettingsAdmission(context.limits, context.signal);
  try {
    for (const [key, incoming] of settings) {
      const action = descriptor.actions.find(item => item.dest === key && item.action !== "_HelpAction" && item.action !== "_VersionAction");
      if (!action) throw new TypeError(`SDK setting ${key} is not applicable to ${request.command}`);
      if (incoming === null && action.default === null) { options[key] = null; continue; }
      if (action.action === "_AppendAction" && action.nargs === 2) {
        if (!Array.isArray(incoming) || incoming.includes(undefined) || incoming.some(pair => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string")) throw new TypeError(`SDK setting ${key} must be a sequence of pairs`);
      } else if (action.action === "_AppendAction" && action.nargs === null) {
        if (!Array.isArray(incoming) || incoming.includes(undefined) || incoming.some(value => typeof value !== "string")) throw new TypeError(`SDK setting ${key} must be an argument sequence`);
      } else if (action.nargs === "*" || action.nargs === "+") {
        if (!Array.isArray(incoming) || (action.nargs === "+" && !incoming.length) || incoming.includes(undefined) || incoming.some(value => typeof value !== "string")) throw new TypeError(`SDK setting ${key} must be an argument sequence`);
      } else if (action.action === "_StoreTrueAction" || action.action === "_StoreFalseAction") {
        if (typeof incoming !== "boolean") throw new TypeError(`SDK setting ${key} must be boolean`);
      } else if (action.type === "builtins.int") {
        if (!(key === "field_size_limit" && incoming === Infinity) && typeof incoming !== "bigint" && (typeof incoming !== "number" || !Number.isSafeInteger(incoming))) throw new TypeError(`SDK setting ${key} must be an integer`);
      } else if (typeof incoming !== "string") throw new TypeError(`SDK setting ${key} must be text`);
      if (action.choices && !action.choices.includes(incoming as string | number)) throw new TypeError(`SDK setting ${key} has an invalid choice`);
      admission.admit(incoming);
      options[key] = structuredClone(incoming);
    }
    // Validate and own every setting before the first capability acquisition.
    // A pending open must not expose later settings to caller mutation.
    for (const [key] of settings) {
      const action = descriptor.actions.find(item => item.dest === key)!;
      if (options[key] !== null && action.type?.startsWith("FileType(")) {
        if (!context.openMatchFile) throw new CsvkitBlocked("csvgrep match-file opening capability");
        if (!files) { files = new MatchFileScope(); context.registerCleanup(files.dispose); }
        const path = options[key] as string;
        options[key] = await files.acquire(() => context.openMatchFile!(path, { cwd: context.cwd, signal: context.signal }));
        context.signal.throwIfAborted();
        if (files.closed) throw new TypeError("match-file scope closed");
      }
    }
    return await perform(descriptor, { kind: "parsed", options, ...(files ? { dispose: files.dispose, matchFiles: files } : {}) }, context, admission.retainedBytes);
  } catch (failure) {
    await files?.dispose().catch(() => {});
    context.signal.throwIfAborted();
    if (failure instanceof CsvkitBlocked) return perform(descriptor, { kind: "blocked", failure }, context);
    throw failure;
  }
}

async function perform(descriptor: CommandDescriptor, parsed: Extract<ParseResult, { kind: "exit" }> | { readonly kind: "blocked"; readonly failure: CsvkitBlocked } | { readonly kind: "parsed"; readonly options: Readonly<Record<string, unknown>>; readonly dispose?: () => Promise<void>; readonly matchFiles?: MatchFileScope }, context: InvocationContext, retainedSettings = 0): Promise<number> {
  const command = descriptor.name;
  let failed = false;
  let failure: unknown;
  let status: number | undefined;
  const runtime = new Runtime({ ...context, registerCleanup: (cleanup, destination) => context.registerCleanup(async () => {
    try { await cleanup(); }
    catch (cleanupFailure) {
      if (!context.signal.aborted && (!failed || failure instanceof CsvkitCleanupError)) throw cleanupFailure;
    }
  }, destination) }, descriptor, parsed.kind === "parsed" ? parsed.options : {}, parsed.kind === "parsed" ? parsed.matchFiles : undefined);
  try {
    runtime.retain(retainedSettings);
    if (parsed.kind === "blocked") throw parsed.failure;
    if (parsed.kind === "exit") {
      if (parsed.stdout) await runtime.write(parsed.stdout);
      if (parsed.stderr) await runtime.write(parsed.stderr, "stderr");
      status = parsed.status;
    } else {
      if (parsed.options.add_bom) await runtime.write("\ufeff");
      if (!descriptor.execute) throw new CsvkitBlocked(`${command} operation engine`);
      status = await descriptor.execute(runtime);
    }
  } catch (caught) {
    failure = caught;
    failed = true;
    if (!context.signal.aborted && caught instanceof CsvkitDiagnostic) {
      try {
        const report = diagnosticReport(caught, parsed.kind === "parsed" && Boolean(parsed.options.verbose),
          parsed.kind === "parsed" ? String(parsed.options.encoding) : "utf-8-sig");
        await runtime.write(report.stderr, "stderr");
        status = report.status;
      } catch (sinkFailure) {
        failure = sinkFailure;
        if (sinkFailure instanceof CsvkitOutputBudgetError || sinkFailure instanceof CsvkitWorkBudgetError) status = 78;
      }
    }
  }
  const results = await Promise.allSettled([runtime.close(), ...(parsed.kind === "parsed" && parsed.dispose ? [parsed.dispose()] : [])]);
  context.signal.throwIfAborted();
  if (status === undefined) throw failure;
  if (!failed) {
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new CsvkitCleanupError(failures, "CSV invocation cleanup failed");
  }
  return status;
}
