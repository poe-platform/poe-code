import {
  getCommandArguments,
  readBytes,
  writeText,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { parseArguments, probe } from "./probe.js";
export interface FfprobeLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}
export interface FfprobeCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<FfprobeLimits>;
}
export function createFfprobeCommand(options: FfprobeCommandsOptions = {}): CommandDefinition {
  const limits = {
    maxInputBytes: 32 * 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
    ...options.limits
  };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid ffprobe limit");
  return {
    name: "ffprobe",
    description: "Inspect audio containers in the virtual filesystem",
    async execute(context) {
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      if (args.includes("-h") || args.includes("--help")) {
        await writeText(
          context.stdout,
          "Usage: ffprobe [-of json|compact|csv|default|flat] [-show_format] [-show_streams] [-show_entries section=fields] [-select_streams a:0] [-i] INPUT\n"
        );
        return { exitCode: 0 };
      }
      let quiet = false;
      try {
        const parsed = parseArguments(args);
        quiet = parsed.quiet;
        let data: Uint8Array;
        if (parsed.filename === "-" || parsed.filename === "pipe:0") {
          const chunks: Uint8Array[] = [];
          let size = 0;
          for await (const chunk of readBytes(context.stdin, context.signal)) {
            size += chunk.length;
            context.inputBudget?.check(size);
            if (size > limits.maxInputBytes) throw new Error("Input byte limit exceeded");
            chunks.push(new Uint8Array(chunk));
          }
          data = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
          }
        } else
          data = await context.fs.readFile(
            parsed.filename.startsWith("/") ? parsed.filename : context.cwd + "/" + parsed.filename,
            { signal: context.signal, maxBytes: limits.maxInputBytes }
          );
        context.inputBudget?.check(data.length);
        if (data.length > limits.maxInputBytes) throw new Error("Input byte limit exceeded");
        const text = probe(data, args);
        if (new TextEncoder().encode(text).length > limits.maxOutputBytes)
          throw new Error("Output byte limit exceeded");
        await writeText(context.stdout, text);
        return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted();
        if (!quiet)
          await writeText(
            context.stderr,
            `ffprobe: ${error instanceof Error ? error.message : String(error)}\n`
          );
        return { exitCode: 1 };
      }
    }
  };
}
export function createFfprobeCommands(
  options: FfprobeCommandsOptions = {}
): readonly CommandDefinition[] {
  return [createFfprobeCommand(options)];
}
export function ffprobeCommands(options: FfprobeCommandsOptions = {}): VirtualShellPlugin {
  const command = createFfprobeCommand(options);
  return {
    name: "ffprobe-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
