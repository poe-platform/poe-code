import { readBytes, type ByteSource, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { concatenate, define, output, pathOf, UsageError } from "../internal.js";
import { PublicDiagnostic } from "../../diagnostics.js";

export async function collectSourceBytes(source: ByteSource, signal: AbortSignal, maxBytes = Infinity): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new PublicDiagnostic(`input exceeds maximum buffer (${maxBytes} bytes)`);
    }
    chunks.push(new Uint8Array(chunk));
  }
  return concatenate(chunks, total);
}
export interface SpongeCommandOptions {
  readonly maxInputBytes?: number;
  readonly replace?: boolean;
}

const DEFAULT_MAX_SPONGE_BYTES = 64 * 1024 * 1024;

export function createSpongeCommand(options: SpongeCommandOptions = {}): CommandDefinition {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_SPONGE_BYTES;
  return define("sponge", async context => {
    let append = false;
    const operands: string[] = [];
    let ended = false;
    for (const arg of context.args) {
      if (ended) {
        operands.push(arg);
        continue;
      }
      if (arg === "--") {
        ended = true;
        continue;
      }
      if (arg === "-a") {
        append = true;
        continue;
      }
      if (arg.startsWith("-") && arg.length > 1) {
        throw new UsageError(`invalid option '${arg}'`);
      }
      operands.push(arg);
    }
    if (operands.length > 1) {
      throw new UsageError("too many operands");
    }

    // Soak all of stdin before touching the output file
    const soaked = await collectSourceBytes(context.stdin, context.signal, maxInputBytes);

    const target = operands[0];
    if (target === undefined || target === "-") {
      await output(context, soaked);
      return { exitCode: 0 };
    }

    const resolved = pathOf(context, target);
    if (append) {
      let existing: Uint8Array | undefined;
      try {
        existing = await context.fs.readFile(resolved, { signal: context.signal });
      } catch {
        existing = undefined;
      }
      if (existing && existing.byteLength > 0) {
        if (existing.byteLength + soaked.byteLength > maxInputBytes) {
          throw new PublicDiagnostic(`combined output exceeds maximum sponge buffer (${maxInputBytes} bytes)`);
        }
        const combined = new Uint8Array(existing.byteLength + soaked.byteLength);
        combined.set(existing, 0);
        combined.set(soaked, existing.byteLength);
        await context.fs.writeFile(resolved, combined, { signal: context.signal });
        return { exitCode: 0 };
      }
    }

    await context.fs.writeFile(resolved, soaked, { signal: context.signal });
    return { exitCode: 0 };
  });
}

export function spongeCommands(options: SpongeCommandOptions = {}): VirtualShellPlugin {
  const command = createSpongeCommand(options);
  return {
    name: "sponge-commands",
    setup(host) {
      if (!options.replace && host.commands.has(command.name)) {
        throw new Error(`Command already registered: ${command.name}`);
      }
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
