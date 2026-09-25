
const pathPosix = {
  resolve(cwd: string, target: string): string {
    const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : cwd + "/" + target);
    const parts = raw.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return "/" + stack.join("/");
  },
  join(a: string, b: string): string {
    if (!a || a === ".") return b;
    return a.endsWith("/") ? a + b : a + "/" + b;
  },
  dirname(p: string): string {
    const idx = p.lastIndexOf("/");
    if (idx < 0) return ".";
    if (idx === 0) return "/";
    return p.slice(0, idx);
  },
  basename(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx < 0 ? p : p.slice(idx + 1);
  },
};

import {
  commandRuntimeIdentity,
  getCommandArguments,
  readBytes,
  writeBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface LessLimits {
  readonly maxInputBytes: number;
}

export interface LessCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<LessLimits>;
  readonly maxInputBytes?: number;
}

export type PagerLimits = LessLimits;
export type PagerCommandsOptions = LessCommandsOptions;
export type PagerOptions = LessCommandsOptions;

export function settings(options: LessCommandsOptions = {}): LessLimits {
  const limits: LessLimits = {
    maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? 64 * 1024 * 1024,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid less limit: ${name}`);
  }
  return Object.freeze(limits);
}

async function readSourceText(source: ByteSource, maxBytes: number, signal: AbortSignal): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`input exceeds maximum size of ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function createPagerCommand(name: "less" | "more", options: LessCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name,
    description: `Non-interactive ${name} pager pass-through`,
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      const maxBytes = Math.min(limits.maxInputBytes, (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxInputBytes);
      const args = context.args;
      let lineNumbers = false;
      let squeezeBlank = false;
      let startLine = 1;
      let startSearch: string | undefined;
      const files: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-?")) {
          await writeText(context.stdout, `Usage: ${name} [-Ns] [+LINE] [+/PATTERN] [FILE...]\n`);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, `${name} (virtual-bash)\n`);
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("+")) {
          const rest = arg.slice(1);
          if (rest.startsWith("/")) {
            startSearch = rest.slice(1);
          } else if (/^\d+$/.test(rest)) {
            startLine = Math.max(1, Number.parseInt(rest, 10));
          }
          continue;
        }
        if (!endOfOptions && arg.startsWith("--")) {
          if (arg === "--LINE-NUMBERS" || arg === "--line-numbers") lineNumbers = true;
          else if (arg === "--squeeze-blank-lines") squeezeBlank = true;
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            if (ch === "N") lineNumbers = true;
            else if (ch === "n") lineNumbers = false;
            else if (ch === "s") squeezeBlank = true;
            else if (ch === "p") {
              startSearch = j < arg.length - 1 ? arg.slice(j + 1) : (args[++i] ?? "");
              break;
            } else if ("Pxz".includes(ch)) {
              if (j === arg.length - 1 && i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
                i++;
              }
              break;
            }
          }
          continue;
        }
        files.push(arg);
      }

      if (!lineNumbers && !squeezeBlank && startLine === 1 && !startSearch && files.length === 0) {
        let total = 0;
        for await (const chunk of readBytes(context.stdin, context.signal)) {
          total += chunk.byteLength;
          if (total > maxBytes) {
            await writeText(context.stderr, `${name}: input exceeds maximum size of ${maxBytes} bytes\n`);
            return { exitCode: 1 };
          }
          await writeBytes(context.stdout, chunk, context.signal);
        }
        return { exitCode: 0 };
      }

      const texts: string[] = [];
      let exitCode = 0;
      if (files.length === 0) {
        texts.push(await readSourceText(context.stdin, maxBytes, context.signal));
      } else {
        for (const file of files) {
          if (file === "-") {
            texts.push(await readSourceText(context.stdin, maxBytes, context.signal));
          } else {
            try {
              const targetPath = pathPosix.resolve(context.cwd, file);
              const raw = await context.fs.readFile(targetPath);
              if (raw.byteLength > maxBytes) {
                await writeText(context.stderr, `${name}: ${file}: input exceeds maximum size\n`);
                return { exitCode: 1 };
              }
              texts.push(new TextDecoder("utf-8", { fatal: false }).decode(raw));
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await writeText(context.stderr, `${name}: ${file}: ${msg}\n`);
              exitCode = 1;
            }
          }
        }
      }

      const combined = texts.join("");
      if (!combined) return { exitCode };

      const hasTrailingNewline = combined.endsWith("\n");
      const rawLines = combined.split("\n");
      if (hasTrailingNewline) rawLines.pop();

      let startIdx = Math.max(0, startLine - 1);
      if (startSearch) {
        const found = rawLines.findIndex(l => l.includes(startSearch));
        if (found >= 0) startIdx = found;
      }

      let out = "";
      let prevBlank = false;
      for (let idx = startIdx; idx < rawLines.length; idx++) {
        const line = rawLines[idx]!;
        const isBlank = line.length === 0;
        if (squeezeBlank && isBlank && prevBlank) continue;
        prevBlank = isBlank;
        const prefix = lineNumbers ? `${String(idx + 1).padStart(6, " ")}  ` : "";
        const isLast = idx === rawLines.length - 1;
        out += prefix + line + (!isLast || hasTrailingNewline ? "\n" : "");
      }

      if (out.length > 0) {
        await writeText(context.stdout, out);
      }
      return { exitCode };
    },
  };
}

export function createLessCommand(options: LessCommandsOptions = {}): CommandDefinition {
  return createPagerCommand("less", options);
}

export function createMoreCommand(options: LessCommandsOptions = {}): CommandDefinition {
  return createPagerCommand("more", options);
}

export function createLessCommands(options: LessCommandsOptions = {}): readonly CommandDefinition[] {
  return [createLessCommand(options), createMoreCommand(options)];
}

export const createPagerCommands = createLessCommands;

export function lessCommands(options: LessCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLessCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "less-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export const pagerCommands = lessCommands;
