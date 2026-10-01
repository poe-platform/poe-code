import { writeText, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";

export interface AliasLimits { readonly maxArgumentBytes: number; readonly maxAliasBytes: number }
export interface AliasCommandsOptions {
  readonly aliases?: Map<string, string>;
  readonly limits?: Partial<AliasLimits>;
  readonly replace?: boolean;
}

export function createAliasCommand(options: AliasCommandsOptions = {}): CommandDefinition {
  const aliases = options.aliases ?? new Map<string, string>();
  const limits = { maxArgumentBytes: 1024 * 1024, maxAliasBytes: 1024 * 1024, ...options.limits };
  for (const value of Object.values(limits)) if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError("Invalid alias limit");
  return { name: "alias", async execute(context) {
    const encoder = new TextEncoder();
    let argumentBytes = 0;
    for (const arg of context.args) {
      context.signal.throwIfAborted();
      argumentBytes += encoder.encode(arg).length;
      if (argumentBytes > limits.maxArgumentBytes) throw new RangeError("alias argument limit exceeded");
    }
    let index = 0;
    let print = false;
    for (; index < context.args.length; index++) {
      const arg = context.args[index]!;
      if (arg === "--") { index++; break; }
      if (!arg.startsWith("-") || arg === "-") break;
      if ([...arg.slice(1)].every(flag => flag === "p")) print = true;
      else { await writeText(context.stderr, `alias: ${arg}: invalid option\n`); return { exitCode: 2 }; }
    }
    const emit = async (name: string): Promise<void> => {
      await writeText(context.stdout, `alias ${name}='${aliases.get(name)!.split("'").join("'\\''")}'\n`);
    };
    if (print || index === context.args.length) for (const name of [...aliases.keys()].sort()) {
      context.signal.throwIfAborted();
      await emit(name);
    }
    let exitCode = 0;
    for (const arg of context.args.slice(index)) {
      context.signal.throwIfAborted();
      const equal = arg.indexOf("=");
      if (equal < 0) {
        if (aliases.has(arg)) await emit(arg);
        else { await writeText(context.stderr, `alias: ${arg}: not found\n`); exitCode = 1; }
        continue;
      }
      const name = arg.slice(0, equal);
      if (!name || [...name].some(char => " /$`=;|&()<>'\"\\\t\r\n".includes(char))) {
        await writeText(context.stderr, `alias: ${name}: invalid alias name\n`);
        exitCode = 1;
        continue;
      }
      const value = arg.slice(equal + 1);
      let bytes = encoder.encode(name).length + encoder.encode(value).length;
      for (const [key, existing] of aliases) if (key !== name) {
        context.signal.throwIfAborted();
        bytes += encoder.encode(key).length + encoder.encode(existing).length;
      }
      if (bytes > limits.maxAliasBytes) throw new RangeError("alias storage limit exceeded");
      aliases.set(name, value);
    }
    return { exitCode };
  } };
}

export function createAliasCommands(options: AliasCommandsOptions = {}): CommandDefinition[] {
  return [createAliasCommand(options)];
}
export function aliasCommands(options: AliasCommandsOptions = {}): VirtualShellPlugin {
  return { name: "alias", setup(host) {
    for (const command of createAliasCommands(options)) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
