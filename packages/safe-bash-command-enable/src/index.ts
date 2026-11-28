import { writeText, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";

export interface EnableLimits {
  readonly maxArgumentBytes: number;
  readonly maxOutputBytes: number;
  readonly maxBuiltins: number;
}
export interface EnableCommandsOptions {
  readonly builtins?: ReadonlySet<string>;
  readonly disabled?: Set<string>;
  readonly limits?: Partial<EnableLimits>;
  readonly replace?: boolean;
}

export function createEnableCommand(options: EnableCommandsOptions = {}): CommandDefinition {
  const builtins = options.builtins ?? new Set<string>();
  const disabled = options.disabled ?? new Set<string>();
  const limits = { maxArgumentBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024, maxBuiltins: 4096, ...options.limits };
  for (const value of Object.values(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError("Invalid enable limit");
  }
  return { name: "enable", async execute(context) {
    context.signal.throwIfAborted();
    if (builtins.size > limits.maxBuiltins) throw new RangeError("enable builtin limit exceeded");
    const encoder = new TextEncoder();
    let argumentBytes = 0;
    for (const arg of context.args) {
      context.signal.throwIfAborted();
      argumentBytes += encoder.encode(arg).length;
      if (argumentBytes > limits.maxArgumentBytes) throw new RangeError("enable argument limit exceeded");
    }
    let outputBytes = 0;
    const emit = async (text: string, diagnostic = false) => {
      context.signal.throwIfAborted();
      outputBytes += encoder.encode(text).length;
      if (outputBytes > limits.maxOutputBytes) throw new RangeError("enable output limit exceeded");
      await writeText(diagnostic ? context.stderr : context.stdout, text);
    };
    let disable = false;
    let all = false;
    let print = false;
    let index = 0;
    for (; index < context.args.length; index++) {
      const arg = context.args[index]!;
      if (arg === "--") { index++; break; }
      if (!arg.startsWith("-") || arg === "-") break;
      for (const flag of arg.slice(1)) {
        if (flag === "n") disable = true;
        else if (flag === "a") all = true;
        else if (flag === "p") print = true;
        else { await emit(`enable: -${flag}: invalid option\n`, true); return { exitCode: 2 }; }
      }
    }
    if (print || index === context.args.length) {
      for (const name of [...builtins].sort()) {
        context.signal.throwIfAborted();
        const off = disabled.has(name);
        if (all || off === disable) await emit(`enable ${off ? "-n " : ""}${name}\n`);
      }
      return { exitCode: 0 };
    }
    let exitCode = 0;
    for (; index < context.args.length; index++) {
      context.signal.throwIfAborted();
      const name = context.args[index]!;
      if (!builtins.has(name)) {
        await emit(`enable: ${name}: not a shell builtin\n`, true);
        exitCode = 1;
      } else if (disable) disabled.add(name);
      else disabled.delete(name);
    }
    return { exitCode };
  } };
}

export function createEnableCommands(options: EnableCommandsOptions = {}): CommandDefinition[] {
  return [createEnableCommand(options)];
}
export function enableCommands(options: EnableCommandsOptions = {}): VirtualShellPlugin {
  return { name: "enable", setup(host) {
    for (const command of createEnableCommands(options)) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
