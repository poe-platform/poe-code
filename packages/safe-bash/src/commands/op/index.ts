import { createOp, type OpCommandContext, type OpCommandOptions } from "@poe-platform/op";
import { readBytes, resolvePath, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";

export { createObjectBackend } from "@poe-platform/op";
export type { OpBackend, OpObjectBackendOptions, OpBackendRequest, OpResolvedApproval } from "@poe-platform/op";

export interface OpCommandsOptions extends OpCommandOptions {
  readonly replace?: boolean;
  readonly authentication?: OpCommandContext["authentication"];
  readonly pluginScope?: OpCommandContext["pluginScope"];
  readonly confirmPluginClear?: OpCommandContext["confirmPluginClear"];
  readonly selectPlugin?: OpCommandContext["selectPlugin"];
}

export function createOpCommand(options: OpCommandsOptions): CommandDefinition {
  const command = createOp(options);
  const authentication = options.authentication === undefined ? undefined : Object.freeze({ ...options.authentication });
  const pluginScope = options.pluginScope === undefined ? undefined : Object.freeze({ ...options.pluginScope });
  const confirmPluginClear = options.confirmPluginClear;
  const selectPlugin = options.selectPlugin;
  return {
    name: "op",
    description: "Object-backed secrets with explicitly granted virtual shell capabilities",
    async execute(context) {
      const { fs, signal, cwd } = context;
      const invocation: OpCommandContext = {
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
        async readFile(path) {
          signal.throwIfAborted();
          const resolved = resolvePath(cwd, path);
          const capabilities = fs.capabilitiesFor ? await fs.capabilitiesFor(resolved, { signal }) : fs.capabilities;
          if (capabilities.read !== true) throw new Error("op requires VFS read capability");
          const bytes = await fs.readFile(resolved, { signal, maxBytes: 16 * 1024 * 1024 });
          signal.throwIfAborted();
          return Uint8Array.from(bytes);
        },
        async writeFile(path, bytes, settings = {}) {
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
        },
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
}

export function opCommands(options: OpCommandsOptions): VirtualShellPlugin {
  const definition = createOpCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "op-commands",
    setup(host) {
      if (!replace && host.commands.has("op")) throw new Error("Command already registered: op");
      host.commands.register(definition, { replace });
    },
  };
}
