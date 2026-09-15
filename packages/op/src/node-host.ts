import * as fs from "node:fs/promises";
import { constants as fileConstants } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, homedir } from "node:os";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { createOp } from "./index.js";
import { createObjectBackend } from "./backend.js";
import { decodeSnapshot, encodeSnapshot } from "./snapshot-codec.js";
import { generateSshKey, transformSshKey } from "./ssh.js";
import type { OpBackend, OpBackendContext, OpObjectBackend } from "./types.js";
import type { OpCommandContext, OpCommandOptions } from "./cli.js";
import type { OpConfirmOverwrite } from "./host-contracts.js";

export { generateSshKey, transformSshKey } from "./ssh.js";
export type { GeneratedSshKey, SshPrivateKeyFormat } from "./ssh.js";
export type { OpConfirmOverwrite } from "./host-contracts.js";

export function normalizePluginScopePath(path: string, separator = sep): string {
  const normalized = path.split(separator).join("/");
  return normalized.startsWith("//") && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export interface NodeHostDependencies extends Pick<OpCommandOptions, "authorize" | "approve" | "authorizeResolution" | "approveResolved" | "approvalMode"> {
  confirmOverwrite?: OpConfirmOverwrite;
  fs?: Pick<typeof fs, "readFile" | "writeFile" | "rename" | "unlink" | "open"> & Partial<Pick<typeof fs, "constants">>;
  spawn?: typeof spawn;
  loadModule?: (specifier: string) => Promise<{ default?: unknown; authorize?: OpCommandOptions["authorize"]; approve?: OpCommandOptions["approve"]; authorizeResolution?: OpCommandOptions["authorizeResolution"]; approveResolved?: OpCommandOptions["approveResolved"] }>;
  cwd?: string;
  version?: string;
  env?: Record<string, string | undefined>;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
  authentication?: OpBackendContext["authentication"];
  pluginScope?: Partial<NonNullable<OpBackendContext["pluginScope"]>>;
  confirmPluginClear?: OpBackendContext["confirmPluginClear"];
  selectPlugin?: OpBackendContext["selectPlugin"];
}

const backendHelp = "\nNode backend configuration:\n  OP_BACKEND_MODULE  Explicit module path or URL exporting a default OpBackend object.\n                     Optional named authorize/approve callbacks control operations.\n  OP_BACKEND_FILE    Explicit JSON object seed or versioned snapshot.\n                     Mutations are saved atomically; reads leave the file unchanged.\n  OP_COMPATIBILITY_CHANNEL  stable (default) or beta command compatibility.\n  OP_PLUGIN_SESSION_ID  Explicit terminal session identity for plugin scopes.\n  Configure exactly one backend; no credentials are discovered automatically.\n";

function writer(stream: Writable): OpCommandContext["stdout"] {
  return {
    isTTY: "isTTY" in stream && stream.isTTY === true,
    write(data) {
      return new Promise<void>((resolveWrite, reject) => {
        const onError = (error: Error) => { reject(error); };
        stream.once("error", onError);
        stream.write(data, (error) => {
          if (error) reject(error);
          else { stream.removeListener("error", onError); resolveWrite(); }
        });
      });
    },
  };
}

async function confirmOutputOverwrite(confirm: OpConfirmOverwrite | undefined, path: string, signal: AbortSignal): Promise<void> {
  if (!confirm) throw new Error("Output destination is not empty; use --force or provide overwrite confirmation.");
  let rejectAbort!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const accepted = await Promise.race([cancelled, Promise.resolve().then(() => {
      signal.throwIfAborted();
      return confirm(Object.freeze({ path }), Object.freeze({ signal }));
    })]);
    signal.throwIfAborted();
    if (accepted !== true) throw new Error("Overwrite was not confirmed");
  } catch {
    signal.throwIfAborted();
    throw new Error("Output overwrite was not confirmed.");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function runOpCli(args: readonly string[], dependencies: NodeHostDependencies = {}): Promise<number> {
  const files = dependencies.fs ?? fs;
  const confirmOverwrite = dependencies.confirmOverwrite;
  const selectPlugin = dependencies.selectPlugin;
  const cwd = dependencies.cwd ?? process.cwd();
  const env = Object.fromEntries(Object.entries(dependencies.env ?? process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = writer(dependencies.stdout ?? process.stdout);
  const stderr = writer(dependencies.stderr ?? process.stderr);
  const controller = new AbortController();
  const signal = dependencies.signal ?? controller.signal;
  const ownedChildren: Promise<unknown>[] = [];
  const interrupt = () => controller.abort(new Error("Interrupted"));
  const terminate = () => controller.abort(new Error("Terminated"));
  if (!dependencies.signal) {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
  }
  try {
    signal.throwIfAborted();
    const channel = env.OP_COMPATIBILITY_CHANNEL ?? "stable";
    if (channel !== "stable" && channel !== "beta") throw new Error("OP_COMPATIBILITY_CHANNEL must be stable or beta.");
    let loaded: OpBackend | undefined;
    let objectBackend: OpObjectBackend | undefined;
    let authorize = dependencies.authorize;
    let approve = dependencies.approve;
    let authorizeResolution = dependencies.authorizeResolution;
    let approveResolved = dependencies.approveResolved;
    async function loadBackend() {
        signal.throwIfAborted();
        if (!loaded) {
          const modulePath = env.OP_BACKEND_MODULE;
          const filePath = env.OP_BACKEND_FILE;
          if (Boolean(modulePath) === Boolean(filePath)) throw new Error("Set exactly one of OP_BACKEND_MODULE or OP_BACKEND_FILE.");
          if (modulePath) {
            const specifier = URL.canParse(modulePath) ? modulePath : pathToFileURL(resolve(cwd, modulePath)).href;
            const module = await (dependencies.loadModule ?? ((specifier: string) => import(specifier)))(specifier);
            if (typeof module.default !== "object" || module.default === null || !("execute" in module.default) || typeof module.default.execute !== "function") {
              throw new Error("OP_BACKEND_MODULE must export a default OpBackend object with execute().");
            }
            loaded = module.default as OpBackend;
            if (module.authorize !== undefined && typeof module.authorize !== "function") throw new Error("Backend authorize export must be a function.");
            if (module.approve !== undefined && typeof module.approve !== "function") throw new Error("Backend approve export must be a function.");
            if (module.authorizeResolution !== undefined && typeof module.authorizeResolution !== "function") throw new Error("Backend authorizeResolution export must be a function.");
            if (module.approveResolved !== undefined && typeof module.approveResolved !== "function") throw new Error("Backend approveResolved export must be a function.");
            authorize ??= module.authorize;
            approve ??= module.approve;
            authorizeResolution ??= module.authorizeResolution;
            approveResolved ??= module.approveResolved;
          } else {
            let seed: unknown;
            try { seed = decodeSnapshot(await files.readFile(resolve(cwd, filePath!), "utf8")); }
            catch { throw new Error("Cannot read OP_BACKEND_FILE as JSON."); }
            if (typeof seed !== "object" || seed === null || Array.isArray(seed)) throw new Error("OP_BACKEND_FILE must contain an object seed.");
            objectBackend = createObjectBackend({ ...seed, ssh: { generate: generateSshKey, transform: transformSshKey } });
            loaded = objectBackend;
          }
        }
        signal.throwIfAborted();
        return loaded;
    }
    const backend: OpBackend = {
      async prepareBinding(requests, context) {
        if (env.OP_BACKEND_FILE) throw new Error("Resolved file backend approval requires persistent revision support");
        const active = await loadBackend();
        if (!active.prepareBinding || !active.validateBinding || !active.cancelBinding) throw new Error("Backend does not support resolved approval");
        return active.prepareBinding(requests, context);
      },
      validateBinding(handle, context) {
        if (!loaded?.validateBinding) throw new Error("Backend does not support binding validation");
        return loaded.validateBinding(handle, context);
      },
      cancelBinding(handle) {
        if (!loaded?.cancelBinding) throw new Error("Backend does not support binding cancellation");
        loaded.cancelBinding(handle);
      },
      async execute(request, context) {
        const active = await loadBackend();
        context.signal.throwIfAborted();
        const before = objectBackend ? encodeSnapshot(objectBackend.snapshot()) : undefined;
        const result = await active.execute(request, context);
        if (objectBackend) {
          const after = encodeSnapshot(objectBackend.snapshot());
          if (before !== after) {
            const destination = resolve(cwd, env.OP_BACKEND_FILE!);
            const temporary = `${destination}.${randomUUID()}.tmp`;
            let cleanup = true;
            try {
              context.signal.throwIfAborted();
              await files.writeFile(temporary, after + "\n", { flag: "wx", mode: 0o600, signal: context.signal });
              context.signal.throwIfAborted();
              await files.rename(temporary, destination);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "EEXIST") cleanup = false;
              throw error;
            } finally {
              if (cleanup) await files.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
            }
          }
        }
        return result;
      },
    };
    const context: OpCommandContext = {
      args, env, signal, stdout, stderr,
      ...(dependencies.authentication === undefined ? {} : { authentication: Object.freeze({ ...dependencies.authentication }) }),
      pluginScope: {
        cwd: normalizePluginScopePath(resolve(cwd, dependencies.pluginScope?.cwd ?? cwd)),
        home: normalizePluginScopePath(resolve(cwd, dependencies.pluginScope?.home ?? homedir())),
        ...((dependencies.pluginScope?.terminalSession ?? env.OP_PLUGIN_SESSION_ID) === undefined ? {} : { terminalSession: dependencies.pluginScope?.terminalSession ?? env.OP_PLUGIN_SESSION_ID }),
      },
      ...(dependencies.confirmPluginClear === undefined ? {} : { confirmPluginClear: dependencies.confirmPluginClear }),
      ...(selectPlugin === undefined ? {} : { selectPlugin }),
      stdin: {
        async *[Symbol.asyncIterator]() {
          signal.throwIfAborted();
          if ("isTTY" in stdin && stdin.isTTY) return;
          const input = new PassThrough();
          const cancelInput = () => { stdin.unpipe(input); input.destroy(); };
          const inputError = (error: Error) => { input.destroy(error); };
          const inputClosed = () => { if (!stdin.readableEnded) input.destroy(new Error("Input closed before ending")); };
          signal.addEventListener("abort", cancelInput, { once: true });
          stdin.once("error", inputError);
          stdin.once("close", inputClosed);
          stdin.pipe(input);
          try {
            for await (const chunk of input) yield chunk;
          } finally {
            signal.removeEventListener("abort", cancelInput);
            stdin.removeListener("error", inputError);
            stdin.removeListener("close", inputClosed);
            stdin.unpipe(input);
            input.destroy();
          }
        },
      },
      async readFile(path) {
        signal.throwIfAborted();
        return files.readFile(resolve(cwd, path), { signal });
      },
      async writeFile(path, data, options = {}) {
        signal.throwIfAborted();
        const mode = options.mode ?? 0o600;
        const destination = resolve(cwd, path);
        const openConstants = files.constants ?? fileConstants;
        const flags = openConstants.O_WRONLY | openConstants.O_CREAT | openConstants.O_NONBLOCK | (options.overwrite ? 0 : openConstants.O_NOFOLLOW);
        const handle = await files.open(destination, flags, mode);
        try {
          signal.throwIfAborted();
          const status = await handle.stat();
          if (!status.isFile()) throw new Error("Output destination must be a regular file.");
          if (!options.overwrite && status.size !== 0) await confirmOutputOverwrite(confirmOverwrite, destination, signal);
          signal.throwIfAborted();
          await handle.chmod(mode);
          signal.throwIfAborted();
          if (options.overwrite || status.size !== 0) await handle.truncate(0);
          signal.throwIfAborted();
          await handle.writeFile(data, { signal });
        } finally {
          await handle.close();
        }
      },
      invoke(command, childArgs, options) {
        signal.throwIfAborted();
        const child = (dependencies.spawn ?? spawn)(command, [...childArgs], {
          cwd, env: options.env, shell: false, stdio: ["pipe", "pipe", "pipe"], signal,
        });
        let failed = false;
        let failure: unknown;
        const fail = (error: unknown) => {
          if (!failed) {
            failed = true;
            failure = error;
            if (child.stdin) stdin.unpipe(child.stdin);
            child.kill();
          }
        };
        const completion = new Promise<number>((resolveExit) => {
          child.on("error", fail);
          child.once("close", (code, childSignal) => resolveExit(code ?? (childSignal ? 128 + constants.signals[childSignal] : 1)));
        });
        ownedChildren.push(completion);
        const forward = async (source: Readable | null, destination: OpCommandContext["stdout"]) => {
          if (source) for await (const chunk of source) await destination.write(new Uint8Array(chunk));
        };
        const inputError = (error: NodeJS.ErrnoException) => {
          if (error.code !== "EPIPE") fail(error);
        };
        const execution = (async () => {
          child.stdin?.on("error", inputError);
          stdin.on("error", fail);
          try {
            if (child.stdin) stdin.pipe(child.stdin);
            const [exitCode] = await Promise.all([completion, forward(child.stdout, options.stdout ?? stdout).catch(fail), forward(child.stderr, options.stderr ?? stderr).catch(fail)]);
            if (failed) throw failure;
            return { exitCode };
          } catch (error) {
            fail(error);
            await completion;
            throw error;
          } finally {
            child.removeListener("error", fail);
            stdin.removeListener("error", fail);
            if (child.stdin) { stdin.unpipe(child.stdin); child.stdin.destroy(); }
          }
        })();
        ownedChildren.push(execution.catch(() => {}));
        return execution;
      },
    };
    const separator = args.indexOf("--");
    const ownArgs = separator < 0 ? args : args.slice(0, separator);
    let version = dependencies.version;
    if (version === undefined) {
      const metadata: unknown = JSON.parse(await files.readFile(new URL("../package.json", import.meta.url), "utf8"));
      if (typeof metadata !== "object" || metadata === null || !("version" in metadata) || typeof metadata.version !== "string") throw new Error("Package version is unavailable.");
      version = metadata.version;
    }
    const result = await createOp({
      backend,
      version,
      channel,
      approvalMode: dependencies.approvalMode,
      async authorize(request, context) {
        if (dependencies.authorize) return dependencies.authorize(request, context);
        if (request.resource === "completion" && !env.OP_BACKEND_MODULE && !env.OP_BACKEND_FILE) return "allow";
        await loadBackend();
        return authorize ? authorize(request, context) : "allow";
      },
      async approve(request, context) {
        return approve ? approve(request, context) : false;
      },
      async authorizeResolution(request, context) {
        return authorizeResolution ? authorizeResolution(request, context) : false;
      },
      async approveResolved(manifest, context) {
        return approveResolved ? approveResolved(manifest, context) : false;
      },
    }).execute(context);
    if (result.exitCode === 0 && args[0] !== "__complete" && args[0] !== "__completeNoDesc" && (args.length === 0 || ownArgs.includes("--help") || ownArgs.includes("-h") || ownArgs[0] === "help")) {
      await stdout.write(new TextEncoder().encode(backendHelp));
    }
    return result.exitCode;
  } catch (error) {
    await stderr.write(new TextEncoder().encode(`op: ${error instanceof Error ? error.message : "Command failed"}\n`));
    return signal.aborted ? 130 : 1;
  } finally {
    await Promise.allSettled(ownedChildren);
    if (!dependencies.signal) {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    }
  }
}
