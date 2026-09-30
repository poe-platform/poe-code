import { parseArguments, helpText } from "./arguments.js";
import { syncCommandEvaluators } from "safe-bash-io-engine/internal";
export function evalSyncTruncate(
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const args = parseArguments(opArgs, false);
    if (args.display === "help") return helpText;
    if (args.display === "version") return "truncate (safe-bash; GNU coreutils 9.7 semantics)\n";
    if (!writeFileSync || args.files.length === 0) return undefined;
    const blockFactor = args.ioBlocks ? 4096n : 1n;
    let refSize: bigint | undefined;
    if (args.reference !== undefined) {
      const refBytes = readFileSync?.(args.reference);
      if (!refBytes) return undefined;
      refSize = BigInt(refBytes.length);
    }
    for (const file of args.files) {
      const existing = readFileSync?.(file);
      if (!existing && args.noCreate) continue;
      const curSize = BigInt(existing?.length ?? 0);
      const base = refSize ?? curSize;
      const scaledSize = args.size === undefined ? undefined : args.size * blockFactor;
      let target: bigint;
      if (scaledSize === undefined) target = refSize!;
      else if (args.mode === "absolute") target = scaledSize;
      else if (args.mode === "relative") target = base + scaledSize;
      else if (args.mode === "<") target = base < scaledSize ? base : scaledSize;
      else if (args.mode === ">") target = base > scaledSize ? base : scaledSize;
      else if (args.mode === "/") target = (base / scaledSize) * scaledSize;
      else target = ((base + scaledSize - 1n) / scaledSize) * scaledSize;
      if (target < 0n) target = 0n;
      if (target > 1048576n) return undefined;
      const n = Number(target);
      const out = new Uint8Array(n);
      if (existing && existing.length > 0) {
        out.set(existing.subarray(0, Math.min(existing.length, n)));
      }
      if (!writeFileSync(file, out)) return undefined;
    }
    return "";
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncTruncate = evalSyncTruncate;
