const syncDdUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function parseSyncDdSize(raw: string): bigint | undefined {
  const m = /^(\d+)([cwbkKMGTPEZY]?i?B?)$/u.exec(raw);
  if (!m) return undefined;
  const base = BigInt(m[1]!);
  const suf = m[2]!;
  if (!suf) return base;
  if (suf === "c") return base;
  if (suf === "w") return base * 2n;
  if (suf === "b") return base * 512n;
  const mults: Record<string, bigint> = {
    k: 1024n, K: 1024n, KiB: 1024n, kB: 1000n, KB: 1000n,
    M: 1048576n, MiB: 1048576n, MB: 1000000n,
    G: 1073741824n, GiB: 1073741824n, GB: 1000000000n,
  };
  const factor = mults[suf];
  if (factor === undefined) return undefined;
  return base * factor;
}

export function evalSyncDd(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let input: string | undefined;
    let status = "default";
    let ibs = 512n;
    let skip = 0n;
    let count: bigint | undefined;
    const convert = new Set<string>();
    for (const arg of opArgs) {
      const eq = arg.indexOf("=");
      if (eq <= 0) return undefined;
      const k = arg.slice(0, eq);
      const v = arg.slice(eq + 1);
      if (k === "if") input = v;
      else if (k === "status") status = v;
      else if (k === "bs" || k === "ibs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        ibs = p;
      } else if (k === "obs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
      } else if (k === "skip" || k === "iseek") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        skip = p;
      } else if (k === "count") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        count = p;
      } else if (k === "conv") {
        for (const item of v.split(",").filter(Boolean)) {
          if (item !== "ucase" && item !== "lcase" && item !== "swab") return undefined;
          convert.add(item);
        }
      } else {
        return undefined;
      }
    }
    if (status !== "none") return undefined;
    if (convert.has("ucase") && convert.has("lcase")) return undefined;
    let sourceBytes = inBytes;
    if (input !== undefined) {
      if (!readFileSync) return undefined;
      sourceBytes = readFileSync(input);
    }
    if (!sourceBytes || sourceBytes.byteLength > 16384) return undefined;
    const ibsNum = Number(ibs);
    if (!Number.isSafeInteger(ibsNum) || ibsNum <= 0) return undefined;
    const skipBytesBig = skip * ibs;
    if (skipBytesBig > BigInt(sourceBytes.byteLength)) return "";
    const startOffset = Number(skipBytesBig);
    let endOffset = sourceBytes.byteLength;
    if (count !== undefined) {
      const limitBig = skipBytesBig + count * ibs;
      if (limitBig < BigInt(endOffset)) endOffset = Number(limitBig);
    }
    const slice = sourceBytes.slice(startOffset, endOffset);
    if (convert.has("swab")) {
      for (let i = 0; i + 1 < slice.byteLength; i += 2) {
        const tmp = slice[i]!;
        slice[i] = slice[i + 1]!;
        slice[i + 1] = tmp;
      }
    }
    if (convert.has("ucase")) {
      for (let i = 0; i < slice.byteLength; i++) {
        const b = slice[i]!;
        if (b >= 97 && b <= 122) slice[i] = b - 32;
      }
    } else if (convert.has("lcase")) {
      for (let i = 0; i < slice.byteLength; i++) {
        const b = slice[i]!;
        if (b >= 65 && b <= 90) slice[i] = b + 32;
      }
    }
    if (slice.includes(0)) return undefined;
    return syncDdUtf8Decoder.decode(slice);
  } catch {
    return undefined;
  }
}

