const syncShufDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const shufWordMax = (1n << 64n) - 1n;
const shufRngPool = new Uint8Array(4096);
let shufRngOffset = 4096;

export function evalSyncShuf(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 64) return undefined;
  let echo = false;
  let repeat = false;
  let zeroTerminated = false;
  let count: number | undefined;
  let rangeLow: number | undefined;
  let rangeSize: number | undefined;
  let randomFile: string | undefined;
  let ended = false;
  const operands: string[] = [];

  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") {
      if (a === "-e" || a === "--echo") { echo = true; continue; }
      if (a === "-r" || a === "--repeat") { repeat = true; continue; }
      if (a === "-z" || a === "--zero-terminated") { zeroTerminated = true; continue; }
      if (/^-[erz]+(?:n[0-9]{1,6})?$/.test(a)) {
        const nIdx = a.indexOf("n");
        const flagsPart = nIdx >= 0 ? a.slice(1, nIdx) : a.slice(1);
        for (const ch of flagsPart) {
          if (ch === "e") echo = true;
          else if (ch === "r") repeat = true;
          else if (ch === "z") zeroTerminated = true;
        }
        if (nIdx >= 0) {
          const n = Number(a.slice(nIdx + 1));
          if (count === undefined || n < count) count = n;
        }
        continue;
      }
      if (a === "-n" || a === "--head-count" || a.startsWith("-n") || a.startsWith("--head-count=")) {
        const v = a.startsWith("--head-count=") ? a.slice(13) : a.length > 2 && a.startsWith("-n") ? a.slice(2) : opArgs[++i];
        if (!v || !/^[0-9]{1,6}$/.test(v)) return undefined;
        const n = Number(v);
        if (count === undefined || n < count) count = n;
        continue;
      }
      if (a === "-i" || a === "--input-range" || a.startsWith("-i") || a.startsWith("--input-range=")) {
        if (rangeLow !== undefined) return undefined;
        const v = a.startsWith("--input-range=") ? a.slice(14) : a.length > 2 && a.startsWith("-i") ? a.slice(2) : opArgs[++i];
        if (!v) return undefined;
        const m = /^([0-9]{1,7})-([0-9]{1,7})$/.exec(v);
        if (!m) return undefined;
        const lo = Number(m[1]!);
        const hi = Number(m[2]!);
        if (hi < lo || hi - lo + 1 > 1024) return undefined;
        rangeLow = lo;
        rangeSize = hi - lo + 1;
        continue;
      }
      if (a === "--random-source" || a.startsWith("--random-source=")) {
        const v = a.startsWith("--random-source=") ? a.slice(16) : opArgs[++i];
        if (!v || (randomFile !== undefined && randomFile !== v)) return undefined;
        randomFile = v;
        continue;
      }
      return undefined;
    }
    operands.push(a);
  }

  if (echo && rangeLow !== undefined) return undefined;
  if (rangeLow !== undefined && operands.length > 0) return undefined;
  if (!echo && rangeLow === undefined && operands.length > 1) return undefined;

  let lines: string[] = [];
  let size = 0;
  if (count === 0) {
    if (repeat || randomFile !== undefined) return undefined;
    if (!echo && rangeLow === undefined && operands.length === 1 && operands[0] !== "-") {
      if (!readFileSync || !readFileSync(operands[0]!)) return undefined;
    }
    return "";
  }
  if (echo) {
    if (operands.length > 1024) return undefined;
    lines = operands.slice();
    size = lines.length;
  } else if (rangeLow !== undefined) {
    size = rangeSize!;
  } else {
    if (operands.length === 0 || operands[0] === "-") {
      if (inBytes.byteLength === 0) return undefined;
    }
    let srcBytes = inBytes;
    if (operands.length === 1 && operands[0] !== "-") {
      if (!readFileSync) return undefined;
      const fBytes = readFileSync(operands[0]!);
      if (!fBytes || fBytes.byteLength > 8192) return undefined;
      srcBytes = fBytes;
    }
    if (!zeroTerminated && srcBytes.includes(0)) return undefined;
    let text: string;
    try {
      text = syncShufDecoder.decode(srcBytes);
    } catch {
      return undefined;
    }
    if (text.length > 0) {
      const sep = zeroTerminated ? "\0" : "\n";
      lines = text.endsWith(sep) ? text.slice(0, -1).split(sep) : text.split(sep);
      if (lines.length > 1024) return undefined;
    }
    size = lines.length;
  }

  if (repeat && size === 0 && (count === undefined || count > 0)) return undefined;
  const ahead = repeat ? (count ?? 1025) : count !== undefined && count < size ? count : size;
  if (ahead > 1024) return undefined;
  if (ahead === 0) return "";

  let randBytes: Uint8Array | undefined;
  let randOff = 0;
  if (randomFile !== undefined) {
    if (!readFileSync) return undefined;
    randBytes = readFileSync(randomFile);
    if (!randBytes) return undefined;
  }

  let rVal = 0n;
  let rMax = 0n;
  const choose = (szNum: number): number | undefined => {
    const sz = BigInt(szNum);
    const target = sz - 1n;
    while (true) {
      while (rMax < target) {
        let b: number;
        if (randBytes !== undefined) {
          if (randOff >= randBytes.length) return undefined;
          b = randBytes[randOff++]!;
        } else {
          if (shufRngOffset >= shufRngPool.length) {
            globalThis.crypto.getRandomValues(shufRngPool);
            shufRngOffset = 0;
          }
          b = shufRngPool[shufRngOffset++]!;
        }
        rVal = ((rVal << 8n) + BigInt(b)) & shufWordMax;
        rMax = ((rMax << 8n) + 255n) & shufWordMax;
      }
      if (rMax === target) {
        const chosen = Number(rVal);
        rVal = rMax = 0n;
        return chosen;
      }
      const excess = rMax - target;
      const unusable = excess % sz;
      const remainder = rVal % sz;
      if (rVal <= rMax - unusable) {
        rVal /= sz;
        rMax = excess / sz;
        return Number(remainder);
      }
      rVal = remainder;
      rMax = unusable - 1n;
    }
  };

  const out: string[] = [];
  const swaps = new Map<number, number>();
  for (let idx = 0; idx < ahead; idx++) {
    let chosen: number;
    if (repeat) {
      const c = choose(size);
      if (c === undefined) return undefined;
      chosen = c;
    } else {
      const c = choose(size - idx);
      if (c === undefined) return undefined;
      const pick = idx + c;
      chosen = swaps.get(pick) ?? pick;
      swaps.set(pick, swaps.get(idx) ?? idx);
      swaps.delete(idx);
    }
    out.push(rangeLow !== undefined ? String(rangeLow + chosen) : lines[chosen]!);
  }
  const term = zeroTerminated ? "\0" : "\n";
  return out.length === 0 ? "" : out.join(term) + term;
}
