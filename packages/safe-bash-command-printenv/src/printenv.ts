import type { CommandDefinition } from "safe-bash-contracts";
import { utf8ByteLength } from "safe-bash-byte-engine";
import { checkSize, command, CommandFailure, emit, ownEnvironment, timeEnvExecutorSettings, type Settings } from "safe-bash-calendar-engine/time-env/shared";

export function createPrintenvWithSettings(configuration: Settings): CommandDefinition {
  return command("printenv", configuration, async context => {
    let separator = "\n";
    let offset = 0;
    for (; offset < context.args.length; offset++) {
      const argument = context.args[offset]!;
      if (argument === "--") { offset++; break; }
      if (argument === "--help") {
        await emit(context, "Usage: printenv [-0|--null] [--] [NAME ...]\nPrint only the virtual command environment.\n", configuration.limits);
        return 0;
      }
      if (argument === "--version") {
        await emit(context, "printenv (safe-bash virtual command)\n", configuration.limits);
        return 0;
      }
      if (argument === "--null" || /^-0+$/.test(argument)) { separator = "\0"; continue; }
      if (argument.startsWith("-") && argument !== "-") throw new CommandFailure(`invalid option: ${argument}`, 2);
      break;
    }
    const names = context.args.slice(offset);
    const lines: string[] = [];
    let total = 0;
    let missing = false;
    const append = (value: string): void => {
      total += utf8ByteLength(value) + 1;
      checkSize(total, configuration.limits.maxOutputBytes, "output");
      lines.push(value, separator);
    };
    if (names.length) {
      for (const name of names) {
        context.signal.throwIfAborted();
        const value = ownEnvironment(context, name);
        if (name.includes("=") || value === undefined) missing = true;
        else append(value);
      }
    } else {
      const keys = Object.getOwnPropertyNames(context.env);
      checkSize(keys.length, configuration.limits.maxEnvironmentEntries, "environment entry");
      for (const name of keys) {
        context.signal.throwIfAborted();
        append(`${name}=${context.env[name]!}`);
      }
    }
    await emit(context, lines.join(""), configuration.limits);
    return missing ? 1 : 0;
  });
}

export function evalSyncPrintenv(
  args: readonly string[],
  exportedNames: ReadonlySet<string>,
  variables: Readonly<Record<string, string | undefined>>,
  execFn?: unknown,
): string | undefined {
  const cfg = execFn ? timeEnvExecutorSettings.get(execFn as never) : undefined;
  if (execFn && !cfg) return undefined;
  let separator = "\n";
  let offset = 0;
  for (; offset < args.length; offset++) {
    const arg = args[offset]!;
    if (arg === "--") {
      offset++;
      break;
    }
    if (arg === "--null" || /^-0+$/.test(arg)) {
      separator = "\0";
      continue;
    }
    if (arg.startsWith("-")) return undefined;
    break;
  }
  const names = args.slice(offset);
  const out: string[] = [];
  if (names.length > 0) {
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      if (name.includes("=") || !exportedNames.has(name)) return undefined;
      const val = variables[name];
      if (typeof val !== "string") return undefined;
      out.push(val);
    }
  } else {
    for (const name of exportedNames) {
      const val = variables[name];
      if (typeof val === "string") out.push(`${name}=${val}`);
    }
  }
  return out.length === 0 ? "" : out.map(x => x + separator).join("");
}
