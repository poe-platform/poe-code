import { createOpCommand as createDispatcher, parseCommand, renderOpHelp, type OpCommandContext, type OpCommandOptions } from "./cli.js";
import { resolveOpCompletion } from "./completion-resolver.js";
import { createSecretHandlers } from "./secrets.js";
import { createCompletionHandler } from "./completion.js";
import { createEnvironmentHandlers } from "./environment-commands.js";
import { createDocumentHandlers } from "./documents.js";
import { createItemHandlers } from "./items.js";
import { createObjectBackend } from "./backend.js";
import { readBytes, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { resolvePath } from "@poe-code/safe-fs/core";

export interface OpCommandsOptions extends OpCommandOptions {
  readonly replace?: boolean;
  readonly authentication?: OpCommandContext["authentication"];
  readonly pluginScope?: OpCommandContext["pluginScope"];
  readonly confirmPluginClear?: OpCommandContext["confirmPluginClear"];
  readonly selectPlugin?: OpCommandContext["selectPlugin"];
}

export * from "./types.js";
export * from "./cli.js";
export type { OpConfirmOverwrite, OpSelectPlugin } from "./host-contracts.js";
export type { OpAdminHook, OpAdminHookResult, OpAdminContext } from "./admin.js";
export type { OpItemTemplate } from "./templates.js";
export { createObjectBackend } from "./backend.js";
export { parseSecretReference } from "./references.js";
export { createSecretHandlers } from "./secrets.js";
export { captureEnvironment, restoreEnvironment, type EnvironmentSnapshot } from "./environment.js";
export { createEnvironmentHandlers, type EnvironmentCommandContext } from "./environment-commands.js";
export { createDocumentHandlers, type OpDocumentHandlerOptions } from "./documents.js";
export { createItemHandlers } from "./items.js";

export function createOp(options: OpCommandOptions = {}) {
  const backend = options.backend ?? createObjectBackend();
  return createDispatcher({
    ...options,
    backend,
    handlers: { ...createSecretHandlers(backend), ...createDocumentHandlers(backend), ...createItemHandlers(backend), ...createEnvironmentHandlers(backend), completion: createCompletionHandler(options.channel), ...options.handlers },
  });
}

export function createOpCommands(options: OpCommandsOptions = {}): readonly [CommandDefinition] {
  return [createOpCommand(options)];
}

export function opCommands(options: OpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOpCommands(options);
  return {
    name: "op-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}

const opMetaByExecutor = new WeakMap<CommandDefinition["execute"], { version: string; channel: "stable" | "beta" }>();

export function evalSyncOp(
  execFn: CommandDefinition["execute"],
  opArgs: readonly string[],
  env: Readonly<Record<string, string>>,
): string | undefined {
  const meta = opMetaByExecutor.get(execFn);
  if (!meta) return undefined;
  const biometric = env.OP_BIOMETRIC_UNLOCK_ENABLED;
  if (biometric !== undefined && biometric !== "true" && biometric !== "false") return undefined;
  try {
    const parsed = parseCommand(opArgs, env, meta.channel);
    if (parsed.flags.version === true) return `${meta.version}\n`;
    if (parsed.help) return renderOpHelp(parsed.path, meta.channel);
    if (parsed.resource === "__complete" || parsed.resource === "__completeNoDesc") {
      const result = resolveOpCompletion(parsed.args, meta.channel);
      const lines = result.candidates.map((c) =>
        parsed.resource === "__complete" ? `${c.value}\t${c.description}` : c.value
      );
      lines.push(`:${result.directive}`);
      return `${lines.join("\n")}\n`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function createOpCommand(options: OpCommandsOptions = {}): CommandDefinition & { execute(context: OpCommandContext): Promise<{ exitCode: number }> } {
  const command = createOp(options);
  const authentication = options.authentication === undefined ? undefined : Object.freeze({ ...options.authentication });
  const pluginScope = options.pluginScope === undefined ? undefined : Object.freeze({ ...options.pluginScope });
  const confirmPluginClear = options.confirmPluginClear;
  const selectPlugin = options.selectPlugin;
  const def: CommandDefinition & { execute(context: OpCommandContext): Promise<{ exitCode: number }> } = {
    name: "op",
    description: "Object-backed secrets with explicitly granted virtual shell capabilities",
    async execute(context: CommandContext | OpCommandContext) {
      if (!("fs" in context)) return command.execute(context);
      const host = context as CommandContext & Partial<Pick<OpCommandContext, "readFile" | "writeFile">>;
      const { fs, signal, cwd } = context;
      const invocation: OpCommandContext = {
        ...host,
        args: context.args,
        env: { ...context.env },
        signal,
        stdin: readBytes(context.stdin, signal),
        stdout: context.stdout,
        stderr: context.stderr,
        ...(authentication === undefined ? {} : { authentication }),
        ...(pluginScope === undefined ? {} : { pluginScope }),
        ...(confirmPluginClear === undefined ? {} : { confirmPluginClear }),
        ...(selectPlugin === undefined ? {} : { selectPlugin }),
        readFile: host.readFile ?? (async (path) => {
          signal.throwIfAborted();
          const resolved = resolvePath(cwd, path);
          const capabilities = fs.capabilitiesFor ? await fs.capabilitiesFor(resolved, { signal }) : fs.capabilities;
          if (capabilities.read !== true) throw new Error("op requires VFS read capability");
          const bytes = await fs.readFile(resolved, { signal });
          signal.throwIfAborted();
          return Uint8Array.from(bytes);
        }),
        writeFile: host.writeFile ?? (async (path, bytes, settings = {}) => {
          signal.throwIfAborted();
          const resolved = resolvePath(cwd, path);
          const capabilities = fs.capabilitiesFor ? await fs.capabilitiesFor(resolved, { signal }) : fs.capabilities;
          if (capabilities.readOnly || capabilities.write !== true || capabilities.permissions !== true || capabilities.exclusiveCreate !== true) {
            throw new Error("op requires VFS write, permissions and exclusive-create capabilities");
          }
          const mode = settings.mode ?? 0o600;
          const data = Uint8Array.from(bytes);
          signal.throwIfAborted();
          try {
            await fs.writeFile(resolved, data, { signal, mode, flag: "wx" });
          } catch (error) {
            if (!settings.overwrite || !error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
            if (!fs.chmod || capabilities.stat !== true) throw new Error("op requires VFS chmod and stat capabilities to overwrite");
            const status = await fs.lstat(resolved, { signal });
            if (status.type !== "file") throw new Error("op output must be a regular file");
            await fs.chmod(resolved, mode, { signal });
            signal.throwIfAborted();
            await fs.writeFile(resolved, data, { signal, mode, flag: "w" });
          }
          signal.throwIfAborted();
          return resolved;
        }),
        ...(context.invoke === undefined ? {} : {
          async invoke(name, args, settings) {
            signal.throwIfAborted();
            const result = await context.invoke!(name, args, {
              signal, cwd, stdin: context.stdin, stdinIsDefault: context.stdinIsDefault ?? false,
              env: { ...settings.env }, replaceEnv: true,
              stdout: settings.stdout ?? context.stdout,
              stderr: settings.stderr ?? context.stderr,
            });
            signal.throwIfAborted();
            return result;
          },
        } satisfies Pick<OpCommandContext, "invoke">),
      };
      return command.execute(invocation);
    },
  };
  opMetaByExecutor.set(def.execute, { version: options.version ?? "0.0.1", channel: options.channel ?? "stable" });
  return def;
}
