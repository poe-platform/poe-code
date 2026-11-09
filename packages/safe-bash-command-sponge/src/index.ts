import { FsError } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";

import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
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
  type FileStat,
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

async function collectSourceBytes(source: ByteSource, maxBytes: number, signal: AbortSignal, admit: (bytes: number) => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let quantum = 0;
  let chunksRead = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    admit(chunk.byteLength);
    signal.throwIfAborted();
    quantum += Math.max(1, chunk.byteLength);
    if (quantum >= 16384 || ++chunksRead >= 128) { quantum = 0; chunksRead = 0; await yieldTurn(signal); }
    if (total > maxBytes) {
      throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
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
      let inputBytes = 0;
      const admit = (bytes: number): void => {
        context.signal.throwIfAborted();
        context.inputBudget?.check(inputBytes += bytes);
      };
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      let append = false;
      const files: string[] = [];
      let endOfOptions = false;

      for (const arg of args) {
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let i = 1; i < arg.length; i++) {
            const ch = arg[i];
            if (ch === "a") append = true;
            else if (ch === "h") {
              await writeText(context.stdout, "sponge [-a] <file>: soak up all input from stdin and write it to <file>\n");
              return { exitCode: 0 };
            }
            else {
              await writeText(context.stderr, `sponge: invalid option -- '${ch}'\n`);
            }
          }
          continue;
        }
        files.push(arg);
        if (context.env.POSIXLY_CORRECT !== undefined) break;
      }

      try {
        const maxBytes = Math.min(limits.maxBufferedBytes, (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxBufferedBytes);
        const buffered = await collectSourceBytes(context.stdin, maxBytes, context.signal, admit);

        if (files.length === 0) {
          await writeBytes(context.stdout, buffered, context.signal);
          return { exitCode: 0 };
        }

        const target = files[0]!;
        // Keep traversal components so the filesystem checks each directory before writing.
        const targetPath = target.startsWith("/") ? target : `${context.cwd}/${target}`;
        let targetStat: FileStat | undefined;
        try {
          targetStat = await context.fs.lstat(targetPath, { signal: context.signal });
        } catch (error) {
          if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
        }
        if (append && targetStat?.type === "file") {
          let existing: Uint8Array = new Uint8Array(0);
          try {
            existing = await context.fs.readFile(targetPath, {
              signal: context.signal,
              ...(Number.isFinite(maxBytes) ? { maxBytes: maxBytes - buffered.byteLength } : {}),
            });
            admit(existing.byteLength);
          } catch (error) {
            context.signal.throwIfAborted();
            if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
            existing = new Uint8Array(0);
          }
          if (existing.byteLength + buffered.byteLength > maxBytes) {
            throw new PublicDiagnostic(`combined output exceeds maximum buffered size of ${maxBytes} bytes`);
          }
        }
        await writeFileOutput(context, buffered, async data => {
          if (targetStat?.type !== "file") {
            await context.fs.writeFile(targetPath, data, { signal: context.signal });
            return;
          }
          const temporary = `${targetPath.slice(0, targetPath.lastIndexOf("/") + 1)}.sponge-${crypto.randomUUID()}`;
          let created = false;
          try {
            if (append) {
              await context.fs.copyFile(targetPath, temporary, { exclusive: true, signal: context.signal });
              created = true;
              await context.fs.appendFile(temporary, data, { signal: context.signal });
            } else {
              await context.fs.writeFile(temporary, new Uint8Array(), { flag: "wx", mode: 0o600, signal: context.signal });
              created = true;
              await context.fs.writeFile(temporary, data, { signal: context.signal });
            }
            if (!context.fs.chmod) throw new FsError("ENOTSUP", { path: targetPath, syscall: "chmod" });
            await context.fs.chmod(temporary, targetStat.mode & 0o7777, { signal: context.signal });
            await context.fs.rename(temporary, targetPath, { signal: context.signal });
            created = false;
          } finally {
            if (created) await context.fs.rm(temporary, { force: true });
          }
        });
        return { exitCode: 0 };
      } catch (err) {
        context.signal.throwIfAborted();
        if (!(err instanceof PublicDiagnostic) && !(err instanceof FsError)) throw err;
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

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export function evalSyncSponge(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  _readFileSync?: (filePath: string) => Uint8Array | undefined,
  _writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  const files: string[] = [];
  let endOfOptions = false;
  for (const arg of opArgs) {
    // Trailing options depend on the invocation environment, unavailable here.
    if (!endOfOptions && files.length > 0 && arg.startsWith("-") && arg.length > 1) return undefined;
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
      for (let i = 1; i < arg.length; i++) {
        if (arg[i] === "a") continue;
        else if (arg[i] === "h") return "sponge [-a] <file>: soak up all input from stdin and write it to <file>\n";
        else return undefined;
      }
      continue;
    }
    files.push(arg);
  }
  if (inBytes === undefined) return undefined;
  const payload = inBytes;
  if (files.length === 0) {
    if (payload.some(b => b === 0 || b >= 128)) return undefined;
    return decoder.decode(payload);
  }
  // The synchronous writer mutates existing inodes. Use the command executor
  // for file destinations so hard links and open descriptors retain old data.
  return undefined;
}
