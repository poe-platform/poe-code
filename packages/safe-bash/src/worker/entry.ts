import { parentPort, workerData } from "node:worker_threads";
import { Shell } from "../shell/shell.js";
import { createAgentCommands } from "../plugins/index.js";
import { createCommandArguments } from "../contracts/command.js";
import { shellValueFromBytes } from "../contracts/value.js";
import { FsError, type FileSystem } from "../contracts/index.js";
import { portableTrapExtension } from "../shell/trap.js";
import type { VirtualShellPlugin } from "../contracts/index.js";
import type { ShellExtension } from "../shell/extensions.js";
import type { WorkerMessage, WorkerModule } from "./protocol.js";
import { filesystemOptionsIndex } from "./protocol.js";

const port = parentPort!;
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
const cancellation = new AbortController();
let deliver: ((signal: number) => boolean) | undefined;
const subscriptions = new Map<object, (signal: number) => boolean>();
const scopeDispositions = new Map<object, ReadonlyMap<number, "ignore" | "trap">>();
let signalSequence = 0;
const signalScopes = new WeakMap<AbortSignal, { id: number; users: number; aborted(): void }>();

function retainSignal(signal: AbortSignal | undefined): { id: number; release(): void } | undefined {
  if (!signal) return undefined;
  signal.throwIfAborted();
  let scope = signalScopes.get(signal);
  if (!scope) {
    const id = ++signalSequence;
    scope = { id, users: 0, aborted() { port.postMessage({ kind: "cancel", signalScope: id }); } };
    signalScopes.set(signal, scope);
    signal.addEventListener("abort", scope.aborted, { once: true });
  }
  const retained = scope;
  retained.users++;
  return { id: retained.id, release() {
    if (--retained.users === 0) {
      signal.removeEventListener("abort", retained.aborted);
      signalScopes.delete(signal);
      port.postMessage({ kind: "release", signalScope: retained.id });
    }
  } };
}

function call(operation: string, args: unknown[] = [], signal?: AbortSignal, receive?: (value: unknown) => void): Promise<unknown> {
  cancellation.signal.throwIfAborted();
  const scope = retainSignal(signal);
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    port.postMessage({ kind: "call", id, operation, args, ...(scope ? { signalScope: scope.id } : {}) });
  }).then(value => {
    // Admit ownership of a returned resource before local cancellation can
    // reject its receipt; its caller still has to close that resource.
    receive?.(value);
    signal?.throwIfAborted();
    return value;
  }, error => {
    signal?.throwIfAborted();
    throw error;
  }).finally(() => scope?.release());
}

port.on("message", (message: WorkerMessage) => {
  if (message.kind === "reply") {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) {
      const error = message.error.code
        ? new FsError(message.error.code as ConstructorParameters<typeof FsError>[0], message.error)
        : new Error(message.error.message);
      error.message = message.error.message;
      request.reject(error);
    }
    else request.resolve(message.value);
  } else if (message.kind === "signal") {
    // Signal zero probes liveness. CONT/CHLD/URG/WINCH have no default
    // terminating disposition; shell traps can override the other signals.
    if (message.number === 0) return;
    if (message.number !== 19 && deliver?.(message.number)) return;
    if ([19, 20, 21, 22].includes(message.number)) {
      // Worker termination remains available while this event loop is stopped.
      // No host-global process signal or borrowed resource is affected.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return;
    }
    if ([17, 18, 23, 28].includes(message.number)) return;
    cancellation.abort(new Error(`Worker signal ${message.number}`));
    port.postMessage({ kind: "result", exitCode: 128 + message.number });
  } else if (message.kind === "start") void run().catch(error => {
    port.postMessage({ kind: "failure", message: error instanceof Error ? error.message : String(error) });
  });
});

const fs: FileSystem = { capabilities: workerData.capabilities } as FileSystem;
const scopes = new Map<number, object>();
if (workerData.readStream) fs.readStream = (path, options) => ({
  async *[Symbol.asyncIterator]() {
    const { signal: _signal, ...portable } = options ?? {};
    // A stream's provider signal outlives its open RPC and every individual pull.
    const scope = retainSignal(options?.signal);
    let id: unknown;
    try {
      await call("readStream.open", [path, portable], options?.signal, value => { id = value; });
      for (;;) {
        const result = await call("readStream.next", [id], options?.signal) as IteratorResult<Uint8Array>;
        if (result.done) return;
        yield result.value;
      }
    } finally {
      try { if (id !== undefined) await call("readStream.close", [id]); }
      finally { scope?.release(); }
    }
  },
});
for (const method of workerData.methods as (keyof typeof filesystemOptionsIndex)[]) {
  Object.defineProperty(fs, method, { enumerable: true, configurable: true, writable: true, value: (...args: unknown[]) => {
    const index = filesystemOptionsIndex[method];
    const options = args[index] as Record<string, unknown> | undefined ?? {};
    args.length = index;
    const { signal, ...portable } = options;
    return call(method, [...args, portable], signal as AbortSignal | undefined).then(value => {
      if ((method === "stat" || method === "lstat") && value && typeof value === "object" && "stat" in value) {
        const envelope = value as { stat: object; scope?: number };
        if (envelope.scope === undefined) return envelope.stat;
        let scope = scopes.get(envelope.scope);
        if (!scope) { scope = Object.freeze({}); scopes.set(envelope.scope, scope); }
        return { ...envelope.stat, identityScope: scope };
      }
      return value;
    });
  } });
}
const input = {
  async *[Symbol.asyncIterator]() {
    for (;;) {
      const result = await call("stdin") as IteratorResult<Uint8Array>;
      if (result.done) return;
      yield result.value;
    }
  },
};
const stdout = { async write(bytes: Uint8Array) { await call("stdout", [bytes]); } };
const stderr = { async write(bytes: Uint8Array) { await call("stderr", [bytes]); } };

const extensions: ShellExtension[] = [portableTrapExtension({ inheritedIgnoredSignals: workerData.ignoredSignals, signalHost: {
  subscribe(listener, scope) {
    subscriptions.set(scope, listener);
    deliver = listener;
    return async () => {
      subscriptions.delete(scope);
      scopeDispositions.delete(scope);
      deliver = [...subscriptions.values()].at(-1);
      const active = [...subscriptions.keys()].at(-1);
      await call("dispositions", [[...(active === undefined ? [] : scopeDispositions.get(active) ?? [])]]);
    };
  },
  async dispositions(scope, actions) {
    scopeDispositions.set(scope, actions);
    const active = [...subscriptions.keys()].at(-1);
    await call("dispositions", [[...(active === undefined ? [] : scopeDispositions.get(active) ?? [])]]);
  },
} })];
const plugins: VirtualShellPlugin[] = [];
for (const module of workerData.modules as WorkerModule[]) {
  const namespace = await import(module.specifier) as Record<string, (options: unknown) => ShellExtension | VirtualShellPlugin>;
  const factory = namespace[module.exportName];
  if (typeof factory !== "function") throw new TypeError("Worker module export must be a factory");
  const configured = factory(module.options);
  if ("setup" in configured) plugins.push(configured);
  else extensions.push(configured);
}
// The bridge already includes the caller's device view and its shared quota.
const shell = new Shell({ fs, cwd: workerData.cwd, env: workerData.env, limits: workerData.limits, capabilities: workerData.shellCapabilities, deviceView: "provided", extensions });
for (const recipe of workerData.recipes as { options: Parameters<typeof createAgentCommands>[0]; names: string[] }[]) {
  const selected = new Set(recipe.names);
  for (const command of createAgentCommands(recipe.options)) if (selected.has(command.name)) shell.register(command, { replace: true });
}
for (const plugin of plugins) shell.use(plugin);

async function run(): Promise<void> {
  const arguments_ = workerData.argumentBytes
    ? createCommandArguments((workerData.argumentBytes as Uint8Array[]).map(bytes => shellValueFromBytes(bytes)))
    : createCommandArguments(workerData.args);
  // The transport entry is the only synthetic command. Its name never enters
  // child argv, and byte arguments do not pass through source interpolation.
  let dispatch = "__timeout_worker_entry";
  while (shell.commands.has(dispatch)) dispatch += "-";
  shell.register({ name: dispatch, async execute(context) {
    context.signal.throwIfAborted();
    return context.invoke!(workerData.command, arguments_.args, {
      argumentValues: arguments_, externalInvocation: true,
      stdin: context.stdin, stdinIsDefault: workerData.stdinIsDefault,
      stdout: context.stdout, stderr: context.stderr,
    });
  } });
  try {
    const result = await shell.exec(dispatch, { stdin: input, stdout, stderr, signal: cancellation.signal,
      state: { cwd: workerData.cwd, umask: workerData.umask },
    });
    await shell.dispose();
    port.postMessage({ kind: "result", exitCode: result.exitCode });
  } finally { await shell.dispose(); }
}

// Plugin installation is asynchronous. Readiness must follow its completion,
// including admission of an explicit module's command inventory.
await shell.exec("");
port.postMessage({ kind: "ready", commands: shell.commands.list().map(command => command.name) });
