import { toByteSource, writeBytes, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { makeSafeJsFsModule } from "../../integrations/safejs/index.js";
import { record, withSignal } from "../../integrations/safejs/values.js";
import { pathOf, UsageError } from "../internal.js";
import { GuestInput, GuestOutput } from "./io.js";
import { commandLimits, defaultSafeJsLimits, invocation, type Invocation } from "./options.js";
import { SafeJsCommandLimitError, type SafeJsCommandsOptions, type SafeJsModule, type SafeJsRuntime } from "./types.js";

export { defaultSafeJsLimits, SafeJsCommandLimitError };
export type { SafeJsBudgetOptions, SafeJsCommandLimits, SafeJsCommandsOptions, SafeJsHostFunction, SafeJsHostValue, SafeJsModule, SafeJsRunOptions, SafeJsRunResult, SafeJsRuntime } from "./types.js";

const help = "Usage: safejs [-p|--print] [-e SOURCE [--] ARG... | FILE ARG... | - ARG...]\nNo source operand reads SafeJS source from stdin. Inline/file source leaves stdin for guest data.\n-p prints the returned string or JSON value followed by LF; this is not Node.js.\nGuest modules: fs, stdio, command. A host-injected SafeJS runtime is required.\n";

export interface SafeJsCommandDialect {
  readonly name: string;
  readonly description: string;
  readonly help: string;
  readonly invocation: (args: readonly string[]) => Invocation;
  readonly prepare?: (source: string, selected: Invocation, modules: Record<string, SafeJsModule>) => {
    readonly source: string;
    readonly bindings: SafeJsModule;
  };
}

function errorInfo(error: unknown): { name: string; code: string; message: string } {
  if (typeof error === "string") return { name: "Error", code: "", message: error };
  if (typeof error !== "object" || error === null) return { name: "Error", code: "", message: "SafeJS execution failed" };
  const field = (name: string): string => {
    const descriptor = Object.getOwnPropertyDescriptor(error, name);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : "";
  };
  return { name: field("name"), code: field("code"), message: field("message") || "SafeJS execution failed" };
}

function validateRuntime<Budget>(runtime: SafeJsRuntime<Budget> | undefined): void {
  if (runtime === undefined) return;
  for (const key of ["run", "createBudget", "makeFsModule", "declareHostOperation"] as const) {
    if (typeof runtime[key] !== "function") throw new TypeError(`SafeJS runtime.${key} must be injected`);
  }
}

export function createSafeJsCommands<Budget = unknown>(options: SafeJsCommandsOptions<Budget> = {}, dialect: SafeJsCommandDialect = {
  name: "safejs", description: "Execute an injected SafeJS interpreter against the virtual filesystem", help, invocation,
}): readonly CommandDefinition[] {
  const limits = commandLimits(options.limits);
  const runtime = options.runtime;
  validateRuntime(runtime);
  return [{ name: dialect.name, description: dialect.description, async execute(context) {
    const deadline = Date.now() + limits.timeoutMs;
    const diagnose = async (message: string): Promise<void> => {
      const diagnostic = new AbortController();
      const timer = setTimeout(() => diagnostic.abort(), Math.max(1, Math.min(limits.timeoutMs, deadline - Date.now())));
      try { await writeBytes(context.stderr, Buffer.from(`${dialect.name}: ${message.slice(0, 4096)}\n`), AbortSignal.any([context.signal, diagnostic.signal])); }
      catch (error) { context.signal.throwIfAborted(); if (!diagnostic.signal.aborted) throw error; }
      finally { clearTimeout(timer); }
    };
    let parsed;
    try { parsed = dialect.invocation(context.args); }
    catch (error) { await diagnose(errorInfo(error).message); return { exitCode: 2 }; }
    context.signal.throwIfAborted();
    if (parsed.help) { await writeBytes(context.stdout, Buffer.from(dialect.help), context.signal); return { exitCode: 0 }; }
    if (!runtime) { await diagnose("runtime not installed; inject run, createBudget, makeFsModule and declareHostOperation"); return { exitCode: 127 }; }
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    let failure: unknown;
    let hasFailure = false;
    const fail = (error: unknown): void => {
      if (!hasFailure && !controller.signal.aborted) {
        hasFailure = true;
        failure = error;
        queueMicrotask(() => controller.abort(error));
      }
    };
    const timeout = setTimeout(() => fail(new SafeJsCommandLimitError("timeoutMs")), limits.timeoutMs);
    let input: GuestInput | undefined;
    const output = new GuestOutput(context.stdout, context.stderr, limits.maxOutputBytes, signal, fail);
    let exitCode = 0;
    let thrown: unknown;
    let failed = false;
    try {
      const fromStdin = parsed.source === undefined && parsed.file === "-";
      let source = parsed.source;
      let filename = parsed.file;
      if (source === undefined) {
        if (!fromStdin) filename = pathOf(context, parsed.file);
        const bytes = fromStdin ? context.stdin : context.fs.readStream && context.fs.capabilities.streamingRead !== false
          ? context.fs.readStream(filename, { signal, chunkSize: 65536 })
          : toByteSource(await withSignal(signal, () => context.fs.readFile(filename, { signal, maxBytes: limits.maxSourceBytes })));
        const reader = new GuestInput(bytes, limits.maxSourceBytes, signal, fail, "maxSourceBytes");
        try { source = await reader.readText(); } finally { await reader.close(); }
      } else if (Buffer.byteLength(source) > limits.maxSourceBytes) throw new SafeJsCommandLimitError("maxSourceBytes");
      if (source.startsWith("\uFEFF")) source = source.slice(1);
      input = new GuestInput(fromStdin ? toByteSource("") : context.stdin, limits.maxInputBytes, signal, fail);
      const guestInput = input;
      const declare = runtime.declareHostOperation;
      const stdio: SafeJsModule = {
        readBytes: declare(async (size?: unknown) => guestInput.readBytes(size), "read-side-effect"),
        readText: declare(async () => guestInput.readText(), "read-side-effect"),
        write: declare(async (text: unknown) => output.text(text), "read-side-effect"),
        writeBytes: declare(async (bytes: unknown) => output.bytes(bytes), "read-side-effect"),
        error: declare(async (text: unknown) => output.text(text, true), "read-side-effect"),
        errorBytes: declare(async (bytes: unknown) => output.bytes(bytes, true), "read-side-effect"),
      };
      const env: Record<string, string> = Object.create(null);
      for (const [key, value] of Object.entries(context.env)) env[key] = value;
      const command: SafeJsModule = {
        args: [...parsed.args], cwd: context.cwd, env,
        setExitCode: declare((value: unknown) => {
          signal.throwIfAborted();
          if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) throw new TypeError("exit code must be an integer from 0 through 255");
          exitCode = value;
        }, "read-side-effect"),
      };
      const budget = runtime.createBudget({ maxSteps: limits.maxSteps, deadline,
        maxCallDepth: limits.maxCallDepth, stringLength: limits.stringLength, arrayLength: limits.arrayLength, dataSize: limits.dataSize });
      const modules = { fs: makeSafeJsFsModule(runtime.makeFsModule, context.fs, { cwd: context.cwd, signal }), stdio, command };
      const prepared = dialect.prepare?.(source, { ...parsed, file: filename }, modules);
      const result = record(await withSignal(signal, () => runtime.run(prepared?.source ?? source, {
        budget, filename, modules, signal, ...(prepared ? { bindings: prepared.bindings } : {}),
        sink: { log: (...args) => output.console(args, false), error: (...args) => output.console(args, true) },
      })), "SafeJS run result");
      signal.throwIfAborted();
      if (result.ok !== true && result.ok !== false) throw new TypeError("Invalid SafeJS run result.ok");
      if (!result.ok) throw result.error;
      if (parsed.print && result.returnValue !== undefined) await output.result(result.returnValue);
      await output.drain();
    } catch (error) { thrown = failure ?? error; failed = true; }
    finally {
      try { await output.drain(); } catch (error) { thrown = failure ?? error; failed = true; }
      controller.abort();
      clearTimeout(timeout);
      await input?.close().catch(() => {});
    }
    context.signal.throwIfAborted();
    if (failed) {
      const info = errorInfo(thrown);
      if (!output.stderrFailed) await diagnose(info.message);
      return { exitCode: thrown instanceof SafeJsCommandLimitError || info.code === "budgetExceeded" ? 124
        : thrown instanceof UsageError || info.name === "ParseError" ? 2 : 1 };
    }
    return { exitCode };
  } }];
}

export function safeJsCommands<Budget = unknown>(options: SafeJsCommandsOptions<Budget> = {}): VirtualShellPlugin {
  const definitions = createSafeJsCommands(options);
  return { name: "safejs-commands", setup(host) {
    if (!options.replace && host.commands.has("safejs")) throw new Error("Command already registered: safejs");
    for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
  } };
}
