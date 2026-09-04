import {
  commandRuntimeIdentity, FsError, getCommandArguments, isFsError, writeBytes,
  type CommandContext, type CommandDefinition, type VirtualShellPlugin,
} from "../../contracts/index.js";
import { shellValueByteLength } from "../../contracts/value.js";

export interface YesCommandOptions {
  readonly maxRecordBytes?: number | undefined;
  readonly chunkBytes?: number | undefined;
}

export interface YesCommandsOptions extends YesCommandOptions {
  readonly replace?: boolean | undefined;
}

const encoder = new TextEncoder();
const help = "Usage: yes [STRING]...\n  or:  yes OPTION\nRepeatedly output a line with all specified STRING(s), or 'y'.\n\n      --help        display this help and exit\n      --version     output version information and exit\n\nGNU coreutils online help: <https://www.gnu.org/software/coreutils/>\nReport any translation bugs to <https://translationproject.org/team/>\nFull documentation <https://www.gnu.org/software/coreutils/yes>\nor available locally via: info '(coreutils) yes invocation'\n";
const version = "yes (virtual-bash GNU-compatible profile)\n";

type Selection =
  | { readonly kind: "repeat"; readonly delimiter: number }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "error"; readonly prefix: string; readonly suffix: string; readonly argument?: number; readonly short?: boolean };

function select(context: CommandContext): Selection {
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    if (argument === "--") return { kind: "repeat", delimiter: index };
    if (argument === "-" || !argument.startsWith("-")) {
      if (Object.hasOwn(context.env, "POSIXLY_CORRECT")) break;
      continue;
    }
    if (!argument.startsWith("--")) {
      return { kind: "error", prefix: "invalid option -- '", suffix: "'", argument: index, short: true };
    }
    const equals = argument.indexOf("=");
    const name = argument.slice(2, equals < 0 ? undefined : equals);
    if (!name) {
      return { kind: "error", prefix: "option '", suffix: "' is ambiguous; possibilities: '--help' '--version'", argument: index };
    }
    const option = "help".startsWith(name) ? "help" : "version".startsWith(name) ? "version" : undefined;
    if (!option) return { kind: "error", prefix: "unrecognized option '", suffix: "'", argument: index };
    if (equals >= 0) return { kind: "error", prefix: `option '--${option}' doesn't allow an argument`, suffix: "" };
    return { kind: "text", text: option === "help" ? help : version };
  }
  return { kind: "repeat", delimiter: -1 };
}

export function createYesCommand(options: YesCommandOptions = {}): CommandDefinition {
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Yes options must be an object");
  const { maxRecordBytes = 1024 * 1024, chunkBytes = 16384 } = options;
  for (const [name, value] of Object.entries({ maxRecordBytes, chunkBytes })) {
    if (typeof value !== "number") throw new TypeError(`Yes ${name} must be a number`);
    if (!Number.isSafeInteger(value) || value < 1 || value > 16 * 1024 * 1024) {
      throw new RangeError(`Yes ${name} must be an integer from 1 to 16777216`);
    }
  }
  return Object.freeze({
    name: "yes",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Repeat a line until canceled or its output consumer closes",
    async execute(context: CommandContext) {
      context.signal.throwIfAborted();
      const supplied = context.argumentValues === undefined ? undefined : getCommandArguments(context);
      const selected = select(context);
      if (selected.kind === "error") {
        const argv = supplied ?? getCommandArguments(context);
        if (selected.argument !== undefined && shellValueByteLength(argv.values[selected.argument]!) > maxRecordBytes) {
          await writeBytes(context.stderr, encoder.encode("yes: record exceeds maxRecordBytes\n"), context.signal);
          return { exitCode: 1 };
        }
        await writeBytes(context.stderr, encoder.encode(`yes: ${selected.prefix}`), context.signal);
        if (selected.argument !== undefined) {
          const bytes = argv.bytes(selected.argument)!;
          await writeBytes(context.stderr, selected.short ? bytes.subarray(1, 2) : bytes, context.signal);
        }
        await writeBytes(context.stderr, encoder.encode(`${selected.suffix}\nTry 'yes --help' for more information.\n`), context.signal);
        return { exitCode: 1 };
      }
      let record: Uint8Array;
      if (selected.kind === "text") record = encoder.encode(selected.text);
      else {
        const values = supplied?.values ?? context.args;
        let length = values.length - (selected.delimiter < 0 ? 0 : 1);
        for (let index = 0; index < values.length && length <= maxRecordBytes; index++) {
          if (index !== selected.delimiter) length += shellValueByteLength(values[index]!);
        }
        if (values.length === (selected.delimiter < 0 ? 0 : 1)) length = 2;
        if (length > maxRecordBytes) {
          await writeBytes(context.stderr, encoder.encode("yes: record exceeds maxRecordBytes\n"), context.signal);
          return { exitCode: 1 };
        }
        const argv = supplied ?? getCommandArguments(context);
        record = new Uint8Array(length);
        let offset = 0;
        for (let index = 0; index < argv.values.length; index++) {
          if (index === selected.delimiter) continue;
          const bytes = argv.bytes(index)!;
          record.set(bytes, offset);
          offset += bytes.length;
          record[offset++] = 32;
        }
        if (!offset) record[0] = 121;
        record[record.length - 1] = 10;
        if (record.length <= chunkBytes / 2) {
          const batch = new Uint8Array(Math.floor(chunkBytes / record.length) * record.length);
          for (let start = 0; start < batch.length; start += record.length) batch.set(record, start);
          record = batch;
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let resume: (() => void) | undefined;
      let closed = false;
      const cleanup = (): void => {
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        const pending = resume;
        resume = undefined;
        pending?.();
      };
      context.registerCleanup?.(cleanup);
      try {
        do {
          for (let offset = 0; offset < record.length; offset += chunkBytes) {
            context.signal.throwIfAborted();
            if (closed) throw new FsError("ECANCELED");
            await writeBytes(context.stdout, record.subarray(offset, Math.min(offset + chunkBytes, record.length)), context.signal);
            context.signal.throwIfAborted();
            if (selected.kind === "repeat") {
              if (closed) throw new FsError("ECANCELED");
              await new Promise<void>(resolve => {
                resume = resolve;
                timer = setTimeout(() => { timer = undefined; resume = undefined; resolve(); }, 0);
              });
            }
          }
        } while (selected.kind === "repeat");
        return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted();
        if (!isFsError(error) || error.code === "EPIPE" || closed) throw error;
        const description = error.code === "EIO" ? "Input/output error"
          : error.code === "ENOSPC" ? "No space left on device"
          : error.code === "EBADF" ? "Bad file descriptor" : error.message;
        await writeBytes(context.stderr, encoder.encode(`yes: standard output: ${description}\n`), context.signal);
        return { exitCode: 1 };
      } finally { cleanup(); }
    },
  });
}

export function createYesCommands(options: YesCommandOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createYesCommand(options)]);
}

export function yesCommands(options: YesCommandsOptions = {}): VirtualShellPlugin {
  const commands = createYesCommands(options);
  const { replace = false } = options;
  if (typeof replace !== "boolean") throw new TypeError("Yes replace must be a boolean");
  return {
    name: "yes-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
