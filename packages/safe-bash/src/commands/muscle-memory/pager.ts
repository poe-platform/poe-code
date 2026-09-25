import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { decoder, define, input, output } from "../internal.js";
import { collectSourceBytes } from "./sponge.js";

export interface PagerCommandsOptions {
  readonly replace?: boolean;
}

async function runPager(name: "less" | "more", context: CommandContext): Promise<{ exitCode: number }> {
  let lineNumbers = false;
  let squeezeBlank = false;
  let startLine = 1;
  let startPattern: string | undefined;
  const files: string[] = [];
  let ended = false;

  for (let i = 0; i < context.args.length; i++) {
    const arg = context.args[i]!;
    if (ended) {
      files.push(arg);
      continue;
    }
    if (arg === "--") {
      ended = true;
      continue;
    }
    if (arg.startsWith("+")) {
      const rest = arg.slice(1);
      if (rest.startsWith("/")) {
        startPattern = rest.slice(1);
      } else if (/^\d+$/u.test(rest)) {
        startLine = Math.max(1, Number.parseInt(rest, 10));
      }
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg === "--LINE-NUMBERS" || arg === "--line-numbers") lineNumbers = true;
      else if (arg === "--squeeze-blank-lines") squeezeBlank = true;
      else if (arg === "--pattern" && i + 1 < context.args.length) startPattern = context.args[++i];
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      for (let c = 1; c < arg.length; c++) {
        const ch = arg[c]!;
        if (ch === "N" && name === "less") lineNumbers = true;
        else if (ch === "s") squeezeBlank = true;
        else if (ch === "p" && name === "less") {
          const rest = arg.slice(c + 1);
          startPattern = rest || context.args[++i];
          break;
        } else if ((ch === "x" || ch === "j" || ch === "z" || ch === "P") && name === "less") {
          const rest = arg.slice(c + 1);
          if (!rest && i + 1 < context.args.length) i++;
          break;
        }
      }
      continue;
    }
    files.push(arg);
  }

  const targets = files.length === 0 ? ["-"] : files;
  if (!lineNumbers && !squeezeBlank && startLine === 1 && startPattern === undefined) {
    for (const file of targets) {
      const bytes = await collectSourceBytes(input(context, file), context.signal);
      await output(context, bytes);
    }
    return { exitCode: 0 };
  }

  for (const file of targets) {
    const text = decoder.decode(await collectSourceBytes(input(context, file), context.signal));
    if (text.length === 0) continue;
    const hasTrailingNewline = text.endsWith("\n");
    const rawLines = text.split("\n");
    if (hasTrailingNewline) rawLines.pop();

    let startIndex = Math.max(0, startLine - 1);
    if (startPattern !== undefined) {
      const idx = rawLines.findIndex(line => line.includes(startPattern!));
      if (idx >= 0) startIndex = idx;
    }

    let prevBlank = false;
    const outLines: string[] = [];
    for (let idx = startIndex; idx < rawLines.length; idx++) {
      const line = rawLines[idx]!;
      const isBlank = line.length === 0;
      if (squeezeBlank && isBlank && prevBlank) continue;
      prevBlank = isBlank;
      if (lineNumbers) {
        outLines.push(`${String(idx + 1).padStart(6, " ")}  ${line}`);
      } else {
        outLines.push(line);
      }
    }
    if (outLines.length > 0) {
      await output(context, outLines.join("\n") + (hasTrailingNewline ? "\n" : ""));
    }
  }
  return { exitCode: 0 };
}

export function createLessCommand(): CommandDefinition {
  return define("less", context => runPager("less", context));
}

export function createMoreCommand(): CommandDefinition {
  return define("more", context => runPager("more", context));
}

export function createPagerCommands(): readonly CommandDefinition[] {
  return [createLessCommand(), createMoreCommand()];
}

export function pagerCommands(options: PagerCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPagerCommands();
  return {
    name: "pager-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
