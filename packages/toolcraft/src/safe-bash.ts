import path from "node:path";
import type { ByteSink, ByteSource, CommandContext, FileSystem, VirtualShellPlugin, ShellCapabilities } from "@poe-platform/safe-bash";
import { cloneDefaultValue, validate, type AnySchema, type Static } from "toolcraft-schema";
import type { Command, CommandNode, Group, HandlerFs } from "./index.js";
import type { HumanInLoopRuntime } from "./human-in-loop/types.js";
import { executeCLICommand, formatCLIName, type CLIInvocationRuntime, type CLIControls } from "./cli.js";
import { validateServices } from "./runtime/io.js";

export interface ToolcraftInvocation<TServices extends object = Record<string, never>> {
  regex?: ShellCapabilities["regex"];
  registerCleanup?: CommandContext["registerCleanup"];
  invoke?: CommandContext["invoke"];
  inputBudget?: CommandContext["inputBudget"];
  cwd: string;
  env: Readonly<Record<string, string>>;
  fs: FileSystem;
  stdin: ByteSource;
  stdout: ByteSink;
  stderr: ByteSink;
  signal: AbortSignal;
  services?: TServices;
  fetch?: typeof globalThis.fetch;
  humanInLoop?: HumanInLoopRuntime | undefined;
}

declare module "./index.js" {
  interface HandlerInvocationCapabilities {
    readonly cwd?: string;
    readonly stdin?: ByteSource;
    readonly stdout?: ByteSink;
    readonly stderr?: ByteSink;
    readonly regex?: ShellCapabilities["regex"];
    readonly registerCleanup?: CommandContext["registerCleanup"];
    readonly invoke?: CommandContext["invoke"];
    readonly inputBudget?: CommandContext["inputBudget"];
  }
}

export interface ToolcraftCapabilities<TServices extends object = Record<string, never>> extends ShellCapabilities {
  readonly services?: TServices | undefined;
  readonly humanInLoop?: HumanInLoopRuntime | undefined;
}

export interface ToolcraftCommandsOptions<TServices extends object = Record<string, never>> {
  services?: TServices | ((invocation: ToolcraftInvocation<TServices>) => TServices);
  defaults?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  apiVersion?: string;
  version?: string;
  controls?: CLIControls;
  humanInLoop?: HumanInLoopRuntime;
}

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer U) => void ? U : never;
type NodeDefaults<T, TPrefix extends string = ""> =
  T extends { readonly __agentKitCommandTypeInfo: { name: infer N extends string; params: infer P } }
    ? P extends AnySchema ? { [K in `${TPrefix}${N}`]?: Partial<Static<P>> } : never
    : T extends { readonly __agentKitGroupTypeInfo: { name: infer N extends string; children: infer C extends readonly unknown[] } }
      ? UnionToIntersection<NodeDefaults<C[number], `${TPrefix}${N}/`>> : never;
export type ToolcraftParameterDefaults<TLibrary> =
  TLibrary extends readonly unknown[] ? UnionToIntersection<NodeDefaults<TLibrary[number]>>
    : TLibrary extends { readonly __agentKitGroupTypeInfo: { children: infer C extends readonly unknown[] } }
      ? UnionToIntersection<NodeDefaults<C[number]>> : ToolcraftCommandsOptions["defaults"];

/** Checks paths, parameter names and values against a library's inferred definitions. */
export function toolcraftDefaults<TLibrary>(
  _library: TLibrary,
  defaults: ToolcraftParameterDefaults<TLibrary>
): ToolcraftParameterDefaults<TLibrary> {
  // Snapshot configuration so changing the caller's defaults cannot change registered commands.
  return cloneDefaultValue(defaults);
}

function discoverCommands<TServices extends object>(root: Group<TServices>, prefix = ""): Map<string, Command<TServices, any, any, any>> {
  const commands = new Map<string, Command<TServices, any, any, any>>();
  const visit = (node: CommandNode<TServices>, commandPath: string): void => {
    if (node.kind === "command") {
      if (node.scope.includes("cli") && !node.hidden) commands.set(commandPath, node);
      return;
    }
    if (node.scope && !node.scope.includes("cli")) return;
    for (const child of node.children) visit(child, `${commandPath}${commandPath ? "/" : ""}${child.name}`);
  };
  if (!root.scope || root.scope.includes("cli")) {
    for (const child of root.children) visit(child, `${prefix}${child.name}`);
  }
  return commands;
}

function visibleLibrary<TServices extends object>(root: Group<TServices>): Group<TServices> {
  const aliases = (node: CommandNode<TServices>): string[] => {
    const name = formatCLIName(node.name, "kebab");
    return name === node.name || node.aliases.includes(name) ? [...node.aliases] : [...node.aliases, name];
  };
  const children = root.children.filter(child => child.kind === "command"
    ? child.scope.includes("cli") && !child.hidden
    : !child.scope || child.scope.includes("cli"))
    .map(child => child.kind === "group" ? visibleLibrary(child) : { ...child, aliases: aliases(child) });
  const defaultCommand = children.find(child => child.kind === "command" && child.name === root.default?.name) as Command<TServices, any, any, any> | undefined;
  return { ...root, aliases: aliases(root), children, default: defaultCommand };
}

function handlerFileSystem(invocation: ToolcraftInvocation<object>): HandlerFs {
  const { fs, signal, cwd } = invocation;
  const resolve = (value: string) => path.posix.resolve(cwd, value);
  return {
    async readFile(value, encoding = "utf8") {
      return Buffer.from(await fs.readFile(resolve(value), { signal })).toString(encoding);
    },
    async writeFile(value, contents, options = {}) {
      const bytes = Buffer.from(contents, options.encoding ?? "utf8");
      const target = resolve(value);
      const flag = options.flag ?? "w";
      if (flag === "a") await fs.appendFile(target, bytes, { signal, mode: options.mode });
      else if (flag === "w" || flag === "wx") await fs.writeFile(target, bytes, { signal, mode: options.mode, flag });
      else throw new Error(`Unsupported virtual write flag: ${flag}`);
    },
    async exists(value) {
      try { await fs.stat(resolve(value), { signal }); return true; }
      catch (error) {
        if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }
    },
    async lstat(value) {
      const stat = await fs.lstat(resolve(value), { signal });
      return { isSymbolicLink: () => stat.type === "symlink" };
    },
    async rename(from, to) { await fs.rename(resolve(from), resolve(to), { signal }); },
    async unlink(value) {
      if (!fs.unlink) throw new Error("Virtual filesystem does not support unlink");
      await fs.unlink(resolve(value), { signal });
    }
  };
}

/** Executes already-tokenized argv in process, using the same parser and dispatch as runCLI. */
export function createToolcraftCommandExecutor<TServices extends object>(
  library: Group<TServices> | readonly Group<TServices>[],
  options: ToolcraftCommandsOptions<TServices> = {}
): { execute(argv: readonly string[], invocation: ToolcraftInvocation<TServices>): Promise<{ exitCode: number }> } {
  const roots: readonly Group<TServices>[] = (Array.isArray(library) ? library : [library as Group<TServices>])
    .filter(root => !root.scope || root.scope.includes("cli"));
  const multiple = Array.isArray(library);
  const commands = new Map(roots.flatMap(root => [...discoverCommands(root, multiple ? `${root.name}/` : "")]));
  const defaults = cloneDefaultValue(options.defaults ?? {});
  for (const [commandPath, values] of Object.entries(defaults)) {
    const command = commands.get(commandPath);
    if (!command) throw new TypeError(`Unknown default command path: ${commandPath}`);
    for (const [key, value] of Object.entries(values)) {
      if (!Object.prototype.hasOwnProperty.call(command.params.shape, key)) throw new TypeError(`Unknown default parameter: ${commandPath}/${key}`);
      const result = validate(command.params.shape[key], value);
      if (!result.ok) throw new TypeError(`Invalid default parameter ${commandPath}/${key}: ${result.issues.map(issue => issue.message).join("; ")}`);
    }
  }
  if (options.services && typeof options.services !== "function") validateServices(options.services);
  return {
    async execute(argv, invocation) {
      invocation.signal.throwIfAborted();
      let services: TServices;
      let root: Group<TServices>;
      try {
        const configuredServices = typeof options.services === "function" ? options.services(invocation) : options.services;
        services = { ...configuredServices, ...invocation.services } as TServices;
        const rootName = multiple ? argv[0] : roots[0]?.name;
        const selectedRoot = multiple ? roots.find(candidate => candidate.name === rootName || formatCLIName(candidate.name, "kebab") === rootName || candidate.aliases.includes(rootName ?? "")) : roots[0];
        if (!selectedRoot) throw new TypeError(`Unknown toolcraft root: ${rootName}`);
        root = selectedRoot;
      } catch (error) {
        invocation.signal.throwIfAborted();
        await invocation.stderr.write(new TextEncoder().encode(`${error instanceof Error ? error.message : String(error)}\n`));
        return { exitCode: 1 };
      }
      const args = multiple ? argv.slice(1) : argv;
      let pending = Promise.resolve();
      let queuedBytes = 0;
      const runtime: CLIInvocationRuntime = {
        signal: invocation.signal,
        exitCode: 0,
        defaults: multiple ? Object.fromEntries(Object.entries(defaults).filter(([key]) => key.startsWith(`${root.name}/`)).map(([key, value]) => [key.slice(root.name.length + 1), value])) : defaults,
        capabilities: { signal: invocation.signal, stdin: invocation.stdin, stdout: invocation.stdout, stderr: invocation.stderr, cwd: invocation.cwd, regex: invocation.regex, registerCleanup: invocation.registerCleanup, invoke: invocation.invoke, inputBudget: invocation.inputBudget },
        write(chunk, stream = "stdout") {
          invocation.signal.throwIfAborted();
          const bytes = new TextEncoder().encode(chunk);
          queuedBytes += bytes.byteLength;
          if (queuedBytes > 1024 * 1024) throw new Error("Toolcraft synchronous output exceeded 1 MiB; use a streaming command for larger output");
          pending = pending.then(async () => {
            invocation.signal.throwIfAborted();
            await invocation[stream].write(bytes);
            queuedBytes -= bytes.byteLength;
          });
          // The awaited flush propagates sink failures; observe immediately to avoid unhandled rejections.
          void pending.catch(() => {});
        },
        async flush() { await pending; }
      };
      const deniedFetch = async (): Promise<never> => { throw new Error("Network capability is unavailable for this invocation"); };
      await executeCLICommand(visibleLibrary(root), {
        argv: ["toolcraft", root.name, ...args],
        rootUsageName: root.name,
        version: options.version,
        apiVersion: options.apiVersion,
        services: services as TServices,
        env: { ...invocation.env },
        fs: handlerFileSystem(invocation),
        fetch: invocation.fetch ?? deniedFetch as typeof globalThis.fetch,
        humanInLoop: Object.prototype.hasOwnProperty.call(invocation, "humanInLoop") ? invocation.humanInLoop : options.humanInLoop,
        controls: { output: true, yes: true, ...options.controls },
        errorReports: false,
        outputEmitter: entry => runtime.write(`${entry}\n`)
      }, runtime);
      return { exitCode: runtime.exitCode };
    }
  };
}

/** Registers every CLI-visible root and alias; nested commands use shared Toolcraft discovery. */
export function toolcraftCommands<TServices extends object>(
  library: Group<TServices> | readonly Group<TServices>[],
  options: ToolcraftCommandsOptions<TServices> = {}
): VirtualShellPlugin {
  const executor = createToolcraftCommandExecutor(library, options);
  const roots: readonly Group<TServices>[] = Array.isArray(library) ? library : [library as Group<TServices>];
  return {
    name: "toolcraft",
    setup(host) {
      if (typeof host.provideCapabilities !== "function") throw new Error("Toolcraft requires a safe-bash runtime with invocation capabilities");
      for (const root of roots) {
        if (root.scope && !root.scope.includes("cli")) continue;
        for (const name of new Set([root.name, formatCLIName(root.name, "kebab"), ...root.aliases])) {
          host.commands.register({
            name,
            description: root.description,
            execute(context: CommandContext) {
              const capabilities = context.capabilities as ToolcraftCapabilities<TServices> | undefined;
              return executor.execute(Array.isArray(library) ? [root.name, ...context.args] : context.args, {
                ...context,
                services: capabilities?.services as TServices | undefined,
                fetch: capabilities?.fetch,
                regex: capabilities?.regex,
                ...(Object.prototype.hasOwnProperty.call(capabilities ?? {}, "humanInLoop") ? { humanInLoop: capabilities?.humanInLoop } : {})
              });
            }
          });
        }
      }
    }
  };
}
