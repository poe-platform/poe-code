
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
  shellValueBytes,
  writeBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface SpongeLimits {
  readonly maxBufferedBytes: number;
}

export interface SpongeCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<SpongeLimits>;
  readonly maxBufferedBytes?: number;
}

export type SpongeOptions = SpongeCommandsOptions;

export function settings(options: SpongeCommandsOptions = {}): SpongeLimits {
  const limits: SpongeLimits = {
    maxBufferedBytes: options.limits?.maxBufferedBytes ?? options.maxBufferedBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid sponge limit: ${name}`);
  }
  return Object.freeze(limits);
}

async function collectSourceBytes(source: ByteSource, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`input exceeds maximum buffered size of ${maxBytes} bytes`);
    }
    if (chunk.byteLength > 0) {
      chunks.push(chunk);
    }
  }
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function createSpongeCommand(options: SpongeCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "sponge",
    description: "Soak up all standard input before writing to a file",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      const args = context.args;
      let append = false;
      const files: string[] = [];
      let endOfOptions = false;

      for (const arg of args) {
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-h")) {
          await writeText(context.stdout, "Usage: sponge [-a] [FILE]\nSoak up standard input and write to FILE (or stdout).\n");
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg === "--version") {
          await writeText(context.stdout, "sponge (virtual-bash)\n");
          return { exitCode: 0 };
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let i = 1; i < arg.length; i++) {
            const ch = arg[i];
            if (ch === "a") append = true;
            else {
              await writeText(context.stderr, `sponge: invalid option -- '${ch}'\n`);
              return { exitCode: 2 };
            }
          }
          continue;
        }
        files.push(arg);
      }

      if (files.length > 1) {
        await writeText(context.stderr, "sponge: too many arguments\n");
        return { exitCode: 2 };
      }

      try {
        const maxBytes = Math.min(limits.maxBufferedBytes, (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxBufferedBytes);
        const buffered = await collectSourceBytes(context.stdin, maxBytes, context.signal);

        if (files.length === 0) {
          await writeBytes(context.stdout, buffered, context.signal);
          return { exitCode: 0 };
        }

        const targetPath = pathPosix.resolve(context.cwd, files[0]!);
        if (append) {
          let existing: Uint8Array = new Uint8Array(0);
          try {
            existing = await context.fs.readFile(targetPath);
          } catch {
            existing = new Uint8Array(0);
          }
          if (existing.byteLength + buffered.byteLength > maxBytes) {
            throw new Error(`combined output exceeds maximum buffered size of ${maxBytes} bytes`);
          }
          const combined = new Uint8Array(existing.byteLength + buffered.byteLength);
          combined.set(existing, 0);
          combined.set(buffered, existing.byteLength);
          await context.fs.writeFile(targetPath, combined);
        } else {
          await context.fs.writeFile(targetPath, buffered);
        }
        return { exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writeText(context.stderr, `sponge: ${msg}\n`);
        return { exitCode: 1 };
      }
    },
  };
}

export function createSpongeCommands(options: SpongeCommandsOptions = {}): readonly CommandDefinition[] {
  return [createSpongeCommand(options)];
}

export function spongeCommands(options: SpongeCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSpongeCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "sponge-commands",
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
