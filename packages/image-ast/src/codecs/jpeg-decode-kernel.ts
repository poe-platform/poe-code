export interface HuffmanTable {
  readonly first: Uint32Array;
  readonly counts: Uint16Array;
  readonly offsets: Uint16Array;
  readonly symbols: Uint8Array;
  readonly fastLut: Int32Array;
}

/** Canonical ranges retain only the 16 wire lengths and admitted symbols. */
export function buildHuffmanTable(counts: Uint8Array, symbols: Uint8Array): HuffmanTable {
  const first = new Uint32Array(16);
  const admitted = new Uint16Array(16);
  const offsets = new Uint16Array(16);
  const fastLut = new Int32Array(256).fill(-1);
  let code = 0,
    available = 2,
    offset = 0;
  for (let length = 0; length < 16; length++) {
    // The legacy tree ignores symbols that exceed the available leaves.
    const count = Math.min(counts[length] ?? 0, available);
    first[length] = code;
    admitted[length] = count;
    offsets[length] = offset;
    if (length < 8) {
      const suffixBits = 7 - length;
      for (let i = 0; i < count; i++) {
        const symbol = symbols[offset + i];
        if (symbol !== undefined) {
          const start = (code + i) << suffixBits;
          fastLut.fill(((length + 1) << 8) | symbol, start, start + (1 << suffixBits));
        }
      }
    }
    offset += count;
    code = (code + count) * 2;
    available = (available - count) * 2;
  }
  return {
    first,
    counts: admitted,
    offsets,
    symbols: new Uint8Array(symbols.subarray(0, offset)),
    fastLut
  };
}

export interface JpegComponentState {
  dcId: number;
  acId: number;
  dcPred: number;
}
/** Shared synchronous entropy kernel; retained callers prepare a bounded source window per block. */
export function createJpegScan(
  byteAt: (position: number) => number | undefined,
  size: number,
  start: number,
  dcTrees: readonly (HuffmanTable | undefined)[],
  acTrees: readonly (HuffmanTable | undefined)[],
  spectralStart: number,
  spectralEnd: number,
  approxHigh: number,
  approxLow: number
) {
  let scanPos = start;
  let bitBuf = 0;
  let bitCount = 0;
  let eobRun = 0;

  const refillBits = (): void => {
    while (bitCount <= 16 && scanPos < size) {
      const b = byteAt(scanPos)!;
      if (b === 0xff) {
        if (scanPos + 1 >= size || byteAt(scanPos + 1) !== 0x00) {
          break;
        }
        scanPos += 2;
        bitBuf = ((bitBuf << 8) | 0xff) >>> 0;
        bitCount += 8;
      } else {
        scanPos++;
        bitBuf = ((bitBuf << 8) | b) >>> 0;
        bitCount += 8;
      }
    }
  };

  const readBit = (): number => {
    if (bitCount === 0) {
      if (scanPos >= size) throw new Error("Truncated JPEG entropy data");
      const b = byteAt(scanPos++)!;
      if (b === 0xff) {
        if (scanPos >= size) throw new Error("Truncated JPEG entropy escape");
        if (byteAt(scanPos++) !== 0x00) throw new Error("Unexpected JPEG marker in entropy data");
      }
      bitBuf = b;
      bitCount = 8;
    }
    const bit = (bitBuf >>> (bitCount - 1)) & 1;
    bitCount--;
    return bit;
  };

  const readBits = (n: number): number => {
    if (n === 0) return 0;
    if (bitCount < n) refillBits();
    if (bitCount >= n) {
      const val = (bitBuf >>> (bitCount - n)) & ((1 << n) - 1);
      bitCount -= n;
      return val;
    }
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | readBit();
    }
    return val;
  };

  const receiveExtend = (n: number): number => {
    if (n === 0) return 0;
    const v = readBits(n);
    return v < 1 << (n - 1) ? v + (-1 << n) + 1 : v;
  };

  const decodeSymbol = (tree: HuffmanTable | undefined): number => {
    if (!tree) throw new Error("Invalid JPEG Huffman code");
    if (bitCount < 8) refillBits();
    if (bitCount >= 8 && tree.fastLut) {
      const peek = (bitBuf >>> (bitCount - 8)) & 0xff;
      const fast = tree.fastLut[peek]!;
      if (fast >= 0) {
        bitCount -= fast >>> 8;
        return fast & 0xff;
      }
    }
    let code = 0;
    for (let length = 0; length < 16; length++) {
      code = code * 2 + readBit();
      const index = code - tree.first[length]!;
      if (index >= 0 && index < tree.counts[length]!) {
        const symbol = tree.symbols[tree.offsets[length]! + index];
        if (symbol !== undefined) return symbol;
        // Missing declared symbols are empty leaves in the legacy tree.
        readBit();
        throw new Error("Invalid JPEG Huffman code");
      }
    }
    // Empty depth-16 leaves consume one more bit before rejecting. Keep
    // truncated/marker diagnostics from that read, including its escape.
    readBit();
    throw new Error("Invalid JPEG Huffman code");
  };

  const decodeBlockBaseline = (comp: JpegComponentState, block: Int32Array): number => {
    block.fill(0);
    const dcTree = dcTrees[comp.dcId];
    const acTree = acTrees[comp.acId];
    const t = decodeSymbol(dcTree);
    const diff = receiveExtend(t);
    comp.dcPred += diff;
    block[0] = comp.dcPred;
    let maxK = 0;
    let k = 1;
    while (k < 64) {
      const rs = decodeSymbol(acTree);
      const r = rs >>> 4;
      const s = rs & 0x0f;
      if (s === 0) {
        if (r === 15) {
          k += 16;
          continue;
        }
        break;
      }
      k += r;
      if (k < 64) {
        block[k] = receiveExtend(s);
        maxK = k;
      }
      k++;
    }
    return maxK;
  };

  const decodeBlockProgressive = (comp: JpegComponentState, block: Int16Array) => {
    if (spectralStart === 0) {
      if (approxHigh === 0) {
        const dcTree = dcTrees[comp.dcId];
        const t = decodeSymbol(dcTree);
        const diff = receiveExtend(t);
        comp.dcPred += diff;
        block[0] = comp.dcPred << approxLow;
      } else {
        if (readBit() !== 0) {
          block[0] = (block[0] ?? 0) | (1 << approxLow);
        }
      }
    } else if (approxHigh === 0) {
      if (eobRun > 0) {
        eobRun--;
        return;
      }
      const acTree = acTrees[comp.acId];
      for (let k = spectralStart; k <= spectralEnd; k++) {
        const rs = decodeSymbol(acTree);
        const r = rs >>> 4;
        const s = rs & 0x0f;
        if (s === 0) {
          if (r < 15) {
            eobRun = (1 << r) + readBits(r) - 1;
            break;
          }
          k += 15;
        } else {
          k += r;
          if (k <= spectralEnd) {
            block[k] = receiveExtend(s) << approxLow;
          }
        }
      }
    } else {
      const bit = 1 << approxLow;
      const refine = (k: number): void => {
        const value = block[k]!;
        if (readBit() && (value & bit) === 0) block[k] = value + (value > 0 ? bit : -bit);
      };
      let k = spectralStart;
      if (eobRun === 0) {
        const acTree = acTrees[comp.acId];
        while (k <= spectralEnd) {
          const rs = decodeSymbol(acTree);
          let zeros = rs >>> 4;
          const size = rs & 0x0f;
          let coefficient = 0;
          if (size !== 0) {
            if (size !== 1) throw new Error("Invalid JPEG refinement coefficient size");
            coefficient = readBit() ? bit : -bit;
          } else if (zeros !== 15) {
            eobRun = (1 << zeros) + readBits(zeros);
            break;
          }
          // Runs count zero coefficients only; existing values each carry
          // a correction bit before the next coefficient is introduced.
          while (k <= spectralEnd) {
            if (block[k] !== 0) refine(k);
            else if (zeros-- === 0) break;
            k++;
          }
          if (k > spectralEnd) throw new Error("JPEG refinement run exceeds spectral band");
          if (coefficient !== 0) block[k] = coefficient;
          k++;
        }
      }
      if (eobRun > 0) {
        for (; k <= spectralEnd; k++) if (block[k] !== 0) refine(k);
        eobRun--;
      }
    }
  };

  return {
    get position() {
      return scanPos;
    },
    decodeBaseline: decodeBlockBaseline,
    decodeProgressive: decodeBlockProgressive,
    restart(position: number) {
      scanPos = position;
      eobRun = 0;
      bitCount = 0;
    }
  };
}
