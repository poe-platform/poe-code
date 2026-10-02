const syncDdUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function parseSyncDdSize(raw: string): bigint | undefined {
  if (!raw) return undefined;
  const factors = raw.split("x");
  if (factors.slice(0, -1).includes("0")) return undefined;
  let product = 1n;
  for (const factor of factors) {
    const trimmedLeading = factor.replace(/^[ \t\r\n\v\f]+/u, "");
    const m = /^(\+?\d*)([cwbkKMGTPEZY]?i?B?)$/u.exec(trimmedLeading);
    if (!m || (!m[1] && !m[2])) return undefined;
    const base = m[1] && m[1] !== "+" ? BigInt(m[1]) : 1n;
    const suf = m[2]!;
    let mult = 1n;
    if (!suf || suf === "c" || suf === "cB" || suf === "B") mult = 1n;
    else if (suf === "w" || suf === "wB") mult = 2n;
    else if (suf === "b" || suf === "bB") mult = 512n;
    else {
      const mults: Record<string, bigint> = {
        k: 1024n, K: 1024n, KiB: 1024n, kB: 1000n, KB: 1000n,
        M: 1048576n, MiB: 1048576n, MB: 1000000n,
        G: 1073741824n, GiB: 1073741824n, GB: 1000000000n,
      };
      const factorMult = mults[suf];
      if (factorMult === undefined) return undefined;
      mult = factorMult;
    }
    product *= base * mult;
  }
  return product;
}

export function evalSyncDd(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
  inPipeline = false,
): string | undefined {
  try {
    let input: string | undefined;
    let output: string | undefined;
    let status = "default";
    let blockSize: bigint | undefined;
    let ibs = 512n;
    let obs = 512n;
    let cbs = 0n;
    let skip = 0n;
    let seek = 0n;
    let count: bigint | undefined;
    let skipBytes = false;
    let seekBytes = false;
    let countBytes = false;
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
        blockSize = p;
      } else if (k === "ibs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        ibs = p;
      } else if (k === "obs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        obs = p;
      } else if (k === "cbs") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p <= 0n) return undefined;
        cbs = p;
      } else if (k === "skip" || k === "iseek") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        skip = p;
        skipBytes = v.includes("B");
      } else if (k === "seek" || k === "oseek") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        seek = p;
        seekBytes = v.includes("B");
      } else if (k === "count") {
        const p = parseSyncDdSize(v);
        if (p === undefined || p < 0n) return undefined;
        count = p;
        countBytes = v.includes("B");
      } else if (k === "conv") {
        for (const item of v.split(",")) {
          if (
            item !== "ucase" && item !== "lcase" && item !== "swab" &&
            item !== "block" && item !== "unblock" && item !== "sync" &&
            item !== "notrunc" && item !== "fsync" && item !== "fdatasync"
          ) return undefined;
          convert.add(item);
        }
      } else if (k === "iflag") {
        for (const item of v.split(",")) {
          if (item !== "skip_bytes" && item !== "count_bytes" && item !== "fullblock") return undefined;
          iflags.add(item);
        }
      } else if (k === "oflag") {
        for (const item of v.split(",")) {
          if (item !== "seek_bytes") return undefined;
          oflags.add(item);
        }
      } else {
        return undefined;
      }
    }
    if (status !== "none") return undefined;
    if (blockSize !== undefined) {
      ibs = blockSize;
      obs = blockSize;
    }
    if (convert.has("ucase") && convert.has("lcase")) return undefined;
    if (convert.has("block") && convert.has("unblock")) return undefined;
    if ((convert.has("block") || convert.has("unblock")) && cbs <= 0n) return undefined;
    skipBytes ||= iflags.has("skip_bytes");
    seekBytes ||= oflags.has("seek_bytes");
    countBytes ||= iflags.has("count_bytes");
    const ibsNum = Number(ibs);
    const obsNum = Number(obs);
    const cbsNum = Number(cbs);
    if (!Number.isSafeInteger(ibsNum) || ibsNum <= 0 || !Number.isSafeInteger(obsNum) || obsNum <= 0) return undefined;
    if ((convert.has("block") || convert.has("unblock")) && (!Number.isSafeInteger(cbsNum) || cbsNum <= 0 || cbsNum > 4096)) return undefined;
    let sourceBytes = inBytes;
    if (input !== undefined) {
      if (input === "/dev/null") {
        sourceBytes = new Uint8Array(0);
      } else if (input === "/dev/zero") {
        if (count === undefined) return undefined;
        const totalZeroBig = (skipBytes ? skip : skip * ibs) + (countBytes ? count : count * ibs);
        if (totalZeroBig > 16384n) return undefined;
        sourceBytes = new Uint8Array(Number(totalZeroBig));
      } else {
        if (!readFileSync) return undefined;
        sourceBytes = readFileSync(input);
      }
    }
    if (!sourceBytes || sourceBytes.byteLength > 16384) return undefined;
    const skipBytesBig = skipBytes ? skip : skip * ibs;
    const startOffset = skipBytesBig > BigInt(sourceBytes.byteLength) ? sourceBytes.byteLength : Number(skipBytesBig);
    let endOffset = sourceBytes.byteLength;
    if (count !== undefined) {
      const limitBig = skipBytesBig + (countBytes ? count : count * ibs);
      if (limitBig < BigInt(endOffset)) endOffset = Number(limitBig);
    }
    let slice: Uint8Array = sourceBytes.slice(startOffset, endOffset);
    if (convert.has("sync") && slice.byteLength > 0) {
      if (ibsNum > 16384) return undefined;
      const padByte = (convert.has("block") || convert.has("unblock")) ? 32 : 0;
      const blocks = Math.ceil(slice.byteLength / ibsNum);
      if (blocks * ibsNum > 16384) return undefined;
      const synced = new Uint8Array(blocks * ibsNum);
      if (padByte !== 0) synced.fill(padByte);
      for (let b = 0; b < blocks; b++) {
        const sub = slice.subarray(b * ibsNum, Math.min(slice.byteLength, (b + 1) * ibsNum));
        synced.set(sub, b * ibsNum);
      }
      slice = synced;
    }
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
    if (convert.has("block")) {
      const out: number[] = [];
      let col = 0;
      for (let i = 0; i < slice.byteLength; i++) {
        const b = slice[i]!;
        if (b === 10) {
          while (col < cbsNum) { out.push(32); col++; }
          col = 0;
        } else {
          if (col < cbsNum) out.push(b);
          col = Math.min(cbsNum + 1, col + 1);
        }
      }
      if (col > 0) {
        while (col < cbsNum) { out.push(32); col++; }
      }
      slice = new Uint8Array(out);
    } else if (convert.has("unblock")) {
      const out: number[] = [];
      let col = 0;
      let spaces = 0;
      for (let i = 0; i < slice.byteLength; i++) {
        const b = slice[i]!;
        if (col === cbsNum) {
          out.push(10);
          col = 0;
          spaces = 0;
        }
        col++;
        if (b === 32) {
          spaces++;
        } else {
          while (spaces > 0) { out.push(32); spaces--; }
          out.push(b);
        }
      }
      if (col > 0) out.push(10);
      slice = new Uint8Array(out);
    }
    if (output === "/dev/null") return "";
    if (output !== undefined) {
      if (!writeFileSync) return undefined;
      const seekBytesBig = seekBytes ? seek : seek * obs;
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
    if (!inPipeline && slice.includes(0)) return undefined;
    return syncDdUtf8Decoder.decode(slice);
  } catch {
    return undefined;
  }
}
