import { writeText, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";

export interface UnaliasLimits { readonly maxArgumentBytes: number }
export interface UnaliasCommandsOptions {
  readonly aliases?: Map<string, string>;
  readonly limits?: Partial<UnaliasLimits>;
  readonly replace?: boolean;
}
export function createUnaliasCommand(options: UnaliasCommandsOptions = {}): CommandDefinition {
  const aliases = options.aliases ?? new Map<string, string>();
  const maximum = options.limits?.maxArgumentBytes ?? 1024 * 1024;
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid unalias limit");
  return { name: "unalias", async execute(context) {
    let bytes = 0;
    for (const arg of context.args) {
      context.signal.throwIfAborted();
      bytes += new TextEncoder().encode(arg).length;
      if (bytes > maximum) throw new RangeError("unalias argument limit exceeded");
    }
    let index = 0;
    let all = false;
    for (; index < context.args.length; index++) {
      const arg = context.args[index]!;
      if (arg === "--") { index++; break; }
      if (!arg.startsWith("-") || arg === "-") break;
      if ([...arg.slice(1)].every(flag => flag === "a")) all = true;
      else { await writeText(context.stderr, `unalias: ${arg}: invalid option\n`); return { exitCode: 2 }; }
    }
    if (all) { aliases.clear(); return { exitCode: 0 }; }
    if (index === context.args.length) {
      await writeText(context.stderr, "unalias: usage: unalias [-a] name [name ...]\n");
      return { exitCode: 2 };
    }
    let exitCode = 0;
    for (const name of context.args.slice(index)) {
      context.signal.throwIfAborted();
      if (!aliases.delete(name)) { await writeText(context.stderr, `unalias: ${name}: not found\n`); exitCode = 1; }
    }
    return { exitCode };
  } };
}
export function createUnaliasCommands(options: UnaliasCommandsOptions = {}): CommandDefinition[] {
  return [createUnaliasCommand(options)];
}
export function unaliasCommands(options: UnaliasCommandsOptions = {}): VirtualShellPlugin {
  return { name: "unalias", setup(host) {
    for (const command of createUnaliasCommands(options)) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
