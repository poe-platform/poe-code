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
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    let input: string | undefined;
    let output: string | undefined;
    let status = "default";
    let ibs = 512n;
    let obs = 512n;
    let skip = 0n;
    let seek = 0n;
    let count: bigint | undefined;
    const convert = new Set<string>();
    const iflags = new Set<string>();
    const oflags = new Set<string>();
    for (const arg of opArgs) {
      const eq = arg.indexOf("=");
      if (eq <= 0) return undefined;
      const k = arg.slice(0, eq);
      const v = arg.slice(eq + 1);
      if (k === "if") input = v;
      else if (k === "of") output = v;
      else if (k === "status") status = v;
      else if (k === "bs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        ibs = p;
        obs = p;
      } else if (k === "ibs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        ibs = p;
      } else if (k === "obs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        obs = p;
      } else if (k === "skip" || k === "iseek") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        skip = p;
      } else if (k === "seek" || k === "oseek") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        seek = p;
      } else if (k === "count") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        count = p;
      } else if (k === "conv") {
        for (const item of v.split(",").filter(Boolean)) {
          if (item !== "ucase" && item !== "lcase" && item !== "swab" && item !== "notrunc" && item !== "fsync" && item !== "fdatasync") return undefined;
          convert.add(item);
        }
      } else if (k === "iflag") {
        for (const item of v.split(",").filter(Boolean)) {
          if (item !== "skip_bytes" && item !== "count_bytes" && item !== "fullblock") return undefined;
          iflags.add(item);
        }
      } else if (k === "oflag") {
        for (const item of v.split(",").filter(Boolean)) {
          if (item !== "seek_bytes" && item !== "append") return undefined;
          oflags.add(item);
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
    const obsNum = Number(obs);
    if (!Number.isSafeInteger(ibsNum) || ibsNum <= 0 || !Number.isSafeInteger(obsNum) || obsNum <= 0) return undefined;
    const skipBytesBig = iflags.has("skip_bytes") ? skip : skip * ibs;
    const startOffset = skipBytesBig > BigInt(sourceBytes.byteLength) ? sourceBytes.byteLength : Number(skipBytesBig);
    let endOffset = sourceBytes.byteLength;
    if (count !== undefined) {
      const limitBig = skipBytesBig + (iflags.has("count_bytes") ? count : count * ibs);
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
    if (output !== undefined) {
      if (!writeFileSync) return undefined;
      const seekBytesBig = oflags.has("seek_bytes") ? seek : seek * obs;
      if (seekBytesBig > 65536n) return undefined;
      const seekOffset = Number(seekBytesBig);
      const existing = (convert.has("notrunc") || oflags.has("append") || seekOffset > 0) ? (readFileSync?.(output) ?? new Uint8Array(0)) : new Uint8Array(0);
      let outBuf: Uint8Array;
      if (oflags.has("append")) {
        outBuf = new Uint8Array(existing.byteLength + slice.byteLength);
        outBuf.set(existing, 0);
        outBuf.set(slice, existing.byteLength);
      } else {
        const finalLen = convert.has("notrunc") ? Math.max(existing.byteLength, seekOffset + slice.byteLength) : seekOffset + slice.byteLength;
        outBuf = new Uint8Array(finalLen);
        if (existing.byteLength > 0) {
          outBuf.set(existing.subarray(0, Math.min(existing.byteLength, finalLen)), 0);
        }
        outBuf.set(slice, seekOffset);
      }
      if (!writeFileSync(output, outBuf)) return undefined;
      return "";
    }
    if (slice.includes(0)) return undefined;
    return syncDdUtf8Decoder.decode(slice);
  } catch {
    return undefined;
  }
}

