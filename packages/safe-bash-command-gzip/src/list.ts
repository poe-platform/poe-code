import type { CommandContext } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import { CodecReader } from "safe-bash-compression-engine/codec";
import { FileOperation } from "safe-bash-compression-engine/file-operation";
import { sourceBytes, type Operand } from "safe-bash-compression-engine/files";
import { output } from "safe-bash-io-engine/internal";

export async function gzipListEntry(context: CommandContext, plan: Operand) {
  const operation = new FileOperation(context);
  try {
    return await operation.run(async () => {
      const source = plan.source === "-" ? context.stdin : sourceBytes(context, plan, operation.signal);
      const reader = new CodecReader(operation.ownSource(source), operation.signal);
      let compressed = 0;
      const byte = async (): Promise<number> => {
        if (compressed && compressed % 4096 === 0) await yieldTurn(operation.signal);
        const chunk = await reader.chunk();
        if (!chunk) throw new PublicDiagnostic("unexpected end of file");
        const value = chunk[0]!;
        reader.restore(chunk.subarray(1));
        compressed++;
        return value;
      };
      try {
        if (await byte() !== 31 || await byte() !== 139) throw new PublicDiagnostic("not in gzip format");
        if (await byte() !== 8) throw new PublicDiagnostic("unknown compression method");
        const flags = await byte();
        if (flags & 0xe0) throw new PublicDiagnostic("invalid gzip header flags");
        for (let i = 0; i < 6; i++) await byte();
        if (flags & 4) {
          const length = (await byte()) | ((await byte()) << 8);
          for (let i = 0; i < length; i++) await byte();
        }
        for (const flag of [8, 16]) if (flags & flag) {
          while (await byte() !== 0) { /* Skip the stored name/comment without retaining it. */ }
        }
        if (flags & 2) { await byte(); await byte(); }
        const overhead = compressed + 8;
        const trailer = new Uint8Array(8);
        for (;;) {
          const chunk = await reader.chunk();
          if (!chunk) break;
          compressed += chunk.length;
          if (chunk.length >= trailer.length) trailer.set(chunk.subarray(-8));
          else {
            trailer.copyWithin(0, chunk.length);
            trailer.set(chunk, trailer.length - chunk.length);
          }
        }
        if (compressed < overhead + 2) throw new PublicDiagnostic("unexpected end of file");
        // Like GNU gzip, listing reads the last member's ISIZE (modulo 2^32).
        const uncompressed = new DataView(trailer.buffer).getUint32(4, true);
        return { compressed, uncompressed, overhead };
      } finally { await reader.close(); }
    });
  } finally { await operation.close(); context.signal.throwIfAborted(); }
}

export async function printGzipListEntry(
  context: CommandContext, entry: { compressed: number; uncompressed: number; overhead: number }, name: string,
): Promise<void> {
  const ratio = entry.uncompressed === 0 ? 0 : 100 * (1 - (entry.compressed - entry.overhead) / entry.uncompressed);
  await output(context, `${String(entry.compressed).padStart(19)} ${String(entry.uncompressed).padStart(19)} ${ratio.toFixed(1).padStart(5)}% ${name}\n`);
}

export function gzipListName(plan: Operand, suffix = ".gz"): string {
  if (plan.source === "-") return "stdout";
  const name = plan.name ?? plan.source;
  const lower = name.toLowerCase();
  const matched = [suffix, ".gz", ".z", "-gz", "-z", "_z"].find(value => lower.endsWith(value.toLowerCase()));
  if (matched) return name.slice(0, -matched.length);
  if (lower.endsWith(".tgz") || lower.endsWith(".taz")) return name.slice(0, -4) + ".tar";
  return name;
}
