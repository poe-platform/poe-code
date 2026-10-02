import { parseArguments, helpText } from "./arguments.js";
import { syncCommandEvaluators } from "safe-bash-io-engine/internal";
export function evalSyncTruncate(
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const args = parseArguments(opArgs, false);
    if (args.display || args.ioBlocks || !writeFileSync || args.files.length === 0) return undefined;
    let refSize: bigint | undefined;
    if (args.reference !== undefined) {
      const refBytes = readFileSync?.(args.reference);
      if (!refBytes) return undefined;
      refSize = BigInt(refBytes.length);
    }
    const blockFactor = 1n;
    const planned: Array<{ file: string; out: Uint8Array }> = [];
    for (const file of args.files) {
      const existing = readFileSync?.(file);
      if (!existing && args.noCreate) return undefined;
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
      planned.push({ file, out });
    }
    for (const { file, out } of planned) {
      if (!writeFileSync(file, out)) return undefined;
    }
    return "";
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncTruncate = evalSyncTruncate;
