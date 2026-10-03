const CODE_LENGTH_CODE_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const DISTANCE_MAP_XY: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
  [0, 2],
  [2, 0],
  [1, 2],
  [-1, 2],
  [2, 1],
  [-2, 1],
  [2, 2],
  [-2, 2],
  [0, 3],
  [3, 0],
  [1, 3],
  [-1, 3],
  [3, 1],
  [-3, 1],
  [2, 3],
  [-2, 3],
  [3, 2],
  [-3, 2],
  [0, 4],
  [4, 0],
  [1, 4],
  [-1, 4],
  [4, 1],
  [-4, 1],
  [3, 3],
  [-3, 3],
  [2, 4],
  [-2, 4],
  [4, 2],
  [-4, 2],
  [0, 5],
  [3, 4],
  [-3, 4],
  [4, 3],
  [-4, 3],
  [5, 0],
  [1, 5],
  [-1, 5],
  [5, 1],
  [-5, 1],
  [2, 5],
  [-2, 5],
  [5, 2],
  [-5, 2],
  [4, 4],
  [-4, 4],
  [3, 5],
  [-3, 5],
  [5, 3],
  [-5, 3],
  [0, 6],
  [6, 0],
  [1, 6],
  [-1, 6],
  [6, 1],
  [-6, 1],
  [2, 6],
  [-2, 6],
  [6, 2],
  [-6, 2],
  [4, 5],
  [-4, 5],
  [5, 4],
  [-5, 4],
  [3, 6],
  [-3, 6],
  [6, 3],
  [-6, 3],
  [0, 7],
  [7, 0],
  [1, 7],
  [-1, 7],
  [5, 5],
  [-5, 5],
  [7, 1],
  [-7, 1],
  [4, 6],
  [-4, 6],
  [6, 4],
  [-6, 4],
  [2, 7],
  [-2, 7],
  [7, 2],
  [-7, 2],
  [3, 7],
  [-3, 7],
  [7, 3],
  [-7, 3],
  [5, 6],
  [-5, 6],
  [6, 5],
  [-6, 5],
  [8, 0],
  [4, 7],
  [-4, 7],
  [7, 4],
  [-7, 4],
  [8, 1],
  [8, 2],
  [6, 6],
  [-6, 6],
  [8, 3],
  [5, 7],
  [-5, 7],
  [7, 5],
  [-7, 5],
  [8, 4],
  [6, 7],
  [-6, 7],
  [7, 6],
  [-7, 6],
  [8, 5],
  [7, 7],
  [-7, 7],
  [8, 6],
  [8, 7]
];

/** Shared VP8L kernel. Every input byte and variable-size word lives in its driver's storage. */
export type WebpEffect =
  | { kind: "byte"; position: number }
  | { kind: "allocate"; length: number }
  | { kind: "get"; position: number }
  | { kind: "set"; position: number; value: number };
export type Work<T> = Generator<WebpEffect, T, number>;
export interface Vector {
  position: number;
  length: number;
}
function* alloc(length: number): Work<Vector> {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(length * 8))
    throw new RangeError("Invalid WebP backing length");
  return { position: yield { kind: "allocate", length: length * 8 }, length };
}
function* get(vector: Vector, index: number): Work<number | undefined> {
  if (!Number.isInteger(index) || index < 0 || index >= vector.length) return undefined;
  return yield { kind: "get", position: vector.position + index * 8 };
}
function* put(vector: Vector, index: number, value: number): Work<void> {
  if (Number.isInteger(index) && index >= 0 && index < vector.length)
    yield { kind: "set", position: vector.position + index * 8, value: value >>> 0 };
}
function* numberAt(position: number): Work<number> {
  return yield { kind: "get", position };
}
function* save(position: number, value: number): Work<void> {
  yield { kind: "set", position, value };
}
function* pushTransform(
  previous: number,
  tr: {
    kind: string;
    sizeBits?: number;
    data?: Vector;
    palette?: Vector;
    widthBits?: number;
    origW?: number;
  }
): Work<number> {
  const record = yield* alloc(8),
    data = tr.data ?? tr.palette;
  yield* save(record.position, previous);
  yield* save(
    record.position + 8,
    tr.kind === "subtractGreen" ? 0 : tr.kind === "predictor" ? 1 : tr.kind === "color" ? 2 : 3
  );
  yield* save(record.position + 16, tr.sizeBits ?? tr.widthBits ?? 0);
  yield* save(record.position + 24, data?.position ?? 0);
  yield* save(record.position + 32, data?.length ?? 0);
  yield* save(record.position + 40, tr.origW ?? 0);
  return record.position;
}
export function* decodeWebpLossless(
  start: number,
  length: number,
  width: number,
  height: number
): Work<Vector> {
  let bitPos = 40;
  const maxBits = length * 8;
  function* readBit(): Work<number> {
    if (bitPos >= maxBits) return 0;
    const byte = yield { kind: "byte", position: start + Math.floor(bitPos / 8) };
    return (byte >>> (bitPos++ % 8)) & 1;
  }
  function* readBits(n: number): Work<number> {
    let value = 0;
    for (let i = 0; i < n; i++) value |= (yield* readBit()) << i;
    return value >>> 0;
  }
  function* decode(tree: number): Work<number> {
    let node = tree;
    while (true) {
      const symbol = yield* numberAt(node + 16);
      if (symbol) return symbol - 1;
      node = yield* numberAt(node + (yield* readBit()) * 8);
      if (!node) return 0;
    }
  }
  function* canonical(lengths: Vector): Work<number> {
    const counts = new Int32Array(16),
      codes = new Int32Array(16);
    let max = 0,
      single = 0,
      nonzero = 0,
      nodes = 1;
    for (let i = 0; i < lengths.length; i++) {
      const l = (yield* get(lengths, i))!;
      if (l) {
        counts[l]!++;
        max = Math.max(max, l);
        single = i;
        nonzero++;
        nodes += l;
      }
    }
    const tree = yield* alloc((nonzero <= 1 ? 1 : nodes) * 3);
    if (nonzero <= 1) {
      yield* save(tree.position + 16, single + 1);
      return tree.position;
    }
    let code = 0;
    for (let i = 1; i <= max; i++) {
      code = (code + counts[i - 1]!) << 1;
      codes[i] = code;
    }
    let used = 1;
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      const n = (yield* get(lengths, symbol))!;
      if (!n) continue;
      const c = codes[n]!++;
      let node = tree.position;
      for (let b = n - 1; b >= 0; b--) {
        const at = node + ((c >>> b) & 1) * 8;
        let next = yield* numberAt(at);
        if (!next) {
          next = tree.position + used++ * 24;
          yield* save(at, next);
        }
        node = next;
      }
      yield* save(node + 16, symbol + 1);
    }
    return tree.position;
  }
  function* readPrefixCode(alphabetSize: number): Work<number> {
    if ((yield* readBit()) === 1) {
      const count = (yield* readBit()) + 1,
        is8 = yield* readBit(),
        symbol = yield* readBits(is8 ? 8 : 1),
        tree = yield* alloc(count === 1 ? 3 : 9);
      if (count === 1) yield* save(tree.position + 16, symbol + 1);
      else {
        const second = yield* readBits(8);
        yield* save(tree.position, tree.position + 24);
        yield* save(tree.position + 8, tree.position + 48);
        yield* save(tree.position + 40, symbol + 1);
        yield* save(tree.position + 64, second + 1);
      }
      return tree.position;
    }
    const count = (yield* readBits(4)) + 4,
      cl = yield* alloc(19);
    for (let i = 0; i < count; i++) yield* put(cl, CODE_LENGTH_CODE_ORDER[i]!, yield* readBits(3));
    const tree = yield* canonical(cl);
    let maxSymbols = alphabetSize;
    if ((yield* readBit()) === 1) {
      const bits = 2 + 2 * (yield* readBits(3));
      maxSymbols = Math.min(alphabetSize, 2 + (yield* readBits(bits)));
    }
    const lengths = yield* alloc(alphabetSize);
    let previous = 8,
      index = 0;
    while (index < alphabetSize && maxSymbols-- > 0) {
      const symbol = yield* decode(tree);
      if (symbol < 16) {
        yield* put(lengths, index++, symbol);
        if (symbol) previous = symbol;
      } else if (symbol === 16) {
        const count = 3 + (yield* readBits(2));
        for (let i = 0; i < count && index < alphabetSize; i++)
          yield* put(lengths, index++, previous);
      } else if (symbol === 17) index += 3 + (yield* readBits(3));
      else if (symbol === 18) index += 11 + (yield* readBits(7));
    }
    return yield* canonical(lengths);
  }
  function* decodePrefixValue(code: number): Work<number> {
    if (code < 4) return code + 1;
    const extra = (code - 2) >>> 1;
    return ((2 + (code & 1)) << extra) + (yield* readBits(extra)) + 1;
  }
  function* decodeSubImage(subW: number, subH: number, isMain: boolean): Work<Vector> {
    type Transform =
      | {
          kind: "subtractGreen";
        }
      | {
          kind: "predictor";
          sizeBits: number;
          data: Vector;
        }
      | {
          kind: "color";
          sizeBits: number;
          data: Vector;
        }
      | {
          kind: "colorIndexing";
          palette: Vector;
          widthBits: number;
          origW: number;
        };
    let transforms = 0;
    let curW = subW;
    if (isMain) {
      while ((yield* readBit()) === 1) {
        const trType = yield* readBits(2);
        if (trType === 2) {
          transforms = yield* pushTransform(transforms, { kind: "subtractGreen" });
        } else if (trType === 0) {
          const sizeBits = (yield* readBits(3)) + 2;
          const blockW = Math.ceil(curW / (1 << sizeBits));
          const blockH = Math.ceil(subH / (1 << sizeBits));
          const trData = yield* decodeSubImage(blockW, blockH, false);
          transforms = yield* pushTransform(transforms, {
            kind: "predictor",
            sizeBits,
            data: trData
          });
        } else if (trType === 1) {
          const sizeBits = (yield* readBits(3)) + 2;
          const blockW = Math.ceil(curW / (1 << sizeBits));
          const blockH = Math.ceil(subH / (1 << sizeBits));
          const trData = yield* decodeSubImage(blockW, blockH, false);
          transforms = yield* pushTransform(transforms, { kind: "color", sizeBits, data: trData });
        } else if (trType === 3) {
          const colorTableSize = (yield* readBits(8)) + 1;
          const palette = yield* decodeSubImage(colorTableSize, 1, false);
          for (let i = 1; i < colorTableSize; i++) {
            const p0 = (yield* get(palette, i - 1))!;
            const p1 = (yield* get(palette, i))!;
            const a = (((p0 >>> 24) & 0xff) + ((p1 >>> 24) & 0xff)) & 0xff;
            const r = (((p0 >>> 16) & 0xff) + ((p1 >>> 16) & 0xff)) & 0xff;
            const g = (((p0 >>> 8) & 0xff) + ((p1 >>> 8) & 0xff)) & 0xff;
            const b = ((p0 & 0xff) + (p1 & 0xff)) & 0xff;
            yield* put(palette, i, ((a << 24) | (r << 16) | (g << 8) | b) >>> 0);
          }
          const widthBits =
            colorTableSize <= 2 ? 3 : colorTableSize <= 4 ? 2 : colorTableSize <= 16 ? 1 : 0;
          const origW = curW;
          curW = Math.ceil(curW / (1 << widthBits));
          transforms = yield* pushTransform(transforms, {
            kind: "colorIndexing",
            palette,
            widthBits,
            origW
          });
        }
      }
    }
    let colorCacheBits = 0;
    if ((yield* readBit()) === 1) {
      colorCacheBits = yield* readBits(4);
    }
    const cacheSize = colorCacheBits > 0 ? 1 << colorCacheBits : 0;
    const colorCache = cacheSize > 0 ? yield* alloc(cacheSize) : undefined;
    const cacheHashShift = 32 - colorCacheBits;
    let metaBits = 0;
    let metaImage: Vector | undefined;
    let metaW = 0;
    let numGroups = 1;
    if (isMain && (yield* readBit()) === 1) {
      metaBits = (yield* readBits(3)) + 2;
      metaW = Math.ceil(curW / (1 << metaBits));
      const metaH = Math.ceil(subH / (1 << metaBits));
      metaImage = yield* decodeSubImage(metaW, metaH, false);
      for (let i = 0; i < metaImage.length; i++) {
        const gIdx = ((yield* get(metaImage, i))! >>> 8) & 0xffff;
        if (gIdx + 1 > numGroups) numGroups = gIdx + 1;
      }
    }
    const groups = yield* alloc(numGroups * 5);
    for (let g = 0; g < numGroups; g++)
      for (let c = 0; c < 5; c++)
        yield* save(
          groups.position + (g * 5 + c) * 8,
          yield* readPrefixCode(c === 0 ? 280 + cacheSize : c === 4 ? 40 : 256)
        );
    const totalPixels = curW * subH;
    const pixels = yield* alloc(totalPixels);
    let p = 0;
    while (p < totalPixels) {
      let groupIdx = 0;
      if (metaImage) {
        const x = p % curW;
        const y = (p / curW) | 0;
        const mIdx = (y >>> metaBits) * metaW + (x >>> metaBits);
        groupIdx = (((yield* get(metaImage, mIdx)) ?? 0) >>> 8) & 0xffff;
      }
      const group = (groupIdx < numGroups ? groupIdx : 0) * 5;
      const s = yield* decode((yield* get(groups, group + 0))!);
      if (s < 256) {
        const r = yield* decode((yield* get(groups, group + 1))!);
        const b = yield* decode((yield* get(groups, group + 2))!);
        const a = yield* decode((yield* get(groups, group + 3))!);
        const argb = ((a << 24) | (r << 16) | (s << 8) | b) >>> 0;
        yield* put(pixels, p++, argb);
        if (colorCache) {
          yield* put(colorCache, Math.imul(argb, 0x1e35a7bd) >>> cacheHashShift, argb);
        }
      } else if (s < 280) {
        const length = yield* decodePrefixValue(s - 256);
        const distSym = yield* decode((yield* get(groups, group + 4))!);
        const distCode = yield* decodePrefixValue(distSym);
        let dist: number;
        if (distCode > 120) {
          dist = distCode - 120;
        } else {
          const [dx, dy] = DISTANCE_MAP_XY[distCode - 1] ?? [1, 0];
          dist = Math.max(1, dy * curW + dx);
        }
        for (let k = 0; k < length && p < totalPixels; k++) {
          const argb = (yield* get(pixels, Math.max(0, p - dist)))!;
          yield* put(pixels, p++, argb);
          if (colorCache) {
            yield* put(colorCache, Math.imul(argb, 0x1e35a7bd) >>> cacheHashShift, argb);
          }
        }
      } else if (colorCache) {
        const argb = (yield* get(colorCache, s - 280)) ?? 0xff000000;
        yield* put(pixels, p++, argb);
        yield* put(colorCache, Math.imul(argb, 0x1e35a7bd) >>> cacheHashShift, argb);
      } else {
        p++;
      }
    }
    let outPixels = pixels;
    while (transforms) {
      const record = { position: transforms, length: 8 };
      const kind = yield* get(record, 1);
      const data = { position: (yield* get(record, 3))!, length: (yield* get(record, 4))! };
      const tr: Transform =
        kind === 0
          ? { kind: "subtractGreen" }
          : kind === 1
            ? { kind: "predictor", sizeBits: (yield* get(record, 2))!, data }
            : kind === 2
              ? { kind: "color", sizeBits: (yield* get(record, 2))!, data }
              : {
                  kind: "colorIndexing",
                  palette: data,
                  widthBits: (yield* get(record, 2))!,
                  origW: (yield* get(record, 5))!
                };
      transforms = (yield* get(record, 0))!;
      if (tr.kind === "subtractGreen") {
        for (let i = 0; i < outPixels.length; i++) {
          const argb = (yield* get(outPixels, i))!;
          const g = (argb >>> 8) & 0xff;
          const r = (((argb >>> 16) & 0xff) + g) & 0xff;
          const b = ((argb & 0xff) + g) & 0xff;
          yield* put(outPixels, i, ((argb & 0xff00ff00) | (r << 16) | b) >>> 0);
        }
      } else if (tr.kind === "colorIndexing") {
        const expanded = yield* alloc(tr.origW * subH);
        const ppb = 1 << tr.widthBits;
        const mask = (1 << (8 >>> tr.widthBits)) - 1;
        const shiftBase = 8 >>> tr.widthBits;
        for (let y = 0; y < subH; y++) {
          for (let x = 0; x < tr.origW; x++) {
            const packed = (yield* get(outPixels, y * curW + (x >>> tr.widthBits)))!;
            const greenByte = (packed >>> 8) & 0xff;
            const subIdx = (greenByte >>> ((x & (ppb - 1)) * shiftBase)) & mask;
            yield* put(expanded, y * tr.origW + x, (yield* get(tr.palette, subIdx)) ?? 0);
          }
        }
        outPixels = expanded;
        curW = tr.origW;
      } else if (tr.kind === "color") {
        const blockW = Math.ceil(curW / (1 << tr.sizeBits));
        const colorTransformDelta = (t: number, c: number) =>
          (((t << 24) >> 24) * ((c << 24) >> 24)) >> 5;
        for (let y = 0; y < subH; y++) {
          for (let x = 0; x < curW; x++) {
            const m = (yield* get(tr.data, (y >>> tr.sizeBits) * blockW + (x >>> tr.sizeBits)))!;
            const gToR = m & 0xff;
            const gToB = (m >>> 8) & 0xff;
            const rToB = (m >>> 16) & 0xff;
            const argb = (yield* get(outPixels, y * curW + x))!;
            const g = (argb >>> 8) & 0xff;
            const r = (((argb >>> 16) & 0xff) + colorTransformDelta(gToR, g)) & 0xff;
            const b =
              ((argb & 0xff) + colorTransformDelta(gToB, g) + colorTransformDelta(rToB, r)) & 0xff;
            yield* put(outPixels, y * curW + x, ((argb & 0xff00ff00) | (r << 16) | b) >>> 0);
          }
        }
      } else if (tr.kind === "predictor") {
        const blockW = Math.ceil(curW / (1 << tr.sizeBits));
        const addArgb = (p1: number, p2: number) => {
          const a = (((p1 >>> 24) & 0xff) + ((p2 >>> 24) & 0xff)) & 0xff;
          const r = (((p1 >>> 16) & 0xff) + ((p2 >>> 16) & 0xff)) & 0xff;
          const g = (((p1 >>> 8) & 0xff) + ((p2 >>> 8) & 0xff)) & 0xff;
          const b = ((p1 & 0xff) + (p2 & 0xff)) & 0xff;
          return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        };
        const avg2 = (p1: number, p2: number) =>
          ((((p1 ^ p2) & 0xfefefefe) >>> 1) + (p1 & p2)) >>> 0;
        const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
        const clampAddSubtractFull = (L: number, T: number, TL: number) => {
          const a = clamp255(((L >>> 24) & 0xff) + ((T >>> 24) & 0xff) - ((TL >>> 24) & 0xff));
          const r = clamp255(((L >>> 16) & 0xff) + ((T >>> 16) & 0xff) - ((TL >>> 16) & 0xff));
          const g = clamp255(((L >>> 8) & 0xff) + ((T >>> 8) & 0xff) - ((TL >>> 8) & 0xff));
          const b = clamp255((L & 0xff) + (T & 0xff) - (TL & 0xff));
          return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        };
        const clampAddSubtractHalf = (L: number, T: number, TL: number) => {
          const avg = avg2(L, T);
          const aa = (avg >>> 24) & 0xff;
          const ar = (avg >>> 16) & 0xff;
          const ag = (avg >>> 8) & 0xff;
          const ab = avg & 0xff;
          const a = clamp255(aa + (((aa - ((TL >>> 24) & 0xff)) / 2) | 0));
          const r = clamp255(ar + (((ar - ((TL >>> 16) & 0xff)) / 2) | 0));
          const g = clamp255(ag + (((ag - ((TL >>> 8) & 0xff)) / 2) | 0));
          const b = clamp255(ab + (((ab - (TL & 0xff)) / 2) | 0));
          return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        };
        const selectPred = (L: number, T: number, TL: number) => {
          const pa =
            Math.abs(((L >>> 24) & 0xff) - ((TL >>> 24) & 0xff)) +
            Math.abs(((L >>> 16) & 0xff) - ((TL >>> 16) & 0xff)) +
            Math.abs(((L >>> 8) & 0xff) - ((TL >>> 8) & 0xff)) +
            Math.abs((L & 0xff) - (TL & 0xff));
          const pb =
            Math.abs(((T >>> 24) & 0xff) - ((TL >>> 24) & 0xff)) +
            Math.abs(((T >>> 16) & 0xff) - ((TL >>> 16) & 0xff)) +
            Math.abs(((T >>> 8) & 0xff) - ((TL >>> 8) & 0xff)) +
            Math.abs((T & 0xff) - (TL & 0xff));
          return pb <= pa ? L : T;
        };
        for (let y = 0; y < subH; y++) {
          for (let x = 0; x < curW; x++) {
            const idx = y * curW + x;
            let pred: number;
            if (x === 0 && y === 0) {
              pred = 0xff000000;
            } else if (y === 0) {
              pred = (yield* get(outPixels, idx - 1))!;
            } else if (x === 0) {
              pred = (yield* get(outPixels, idx - curW))!;
            } else {
              const mode =
                (((yield* get(tr.data, (y >>> tr.sizeBits) * blockW + (x >>> tr.sizeBits))) ??
                  0) >>>
                  8) &
                0x0f;
              const L = (yield* get(outPixels, idx - 1))!;
              const T = (yield* get(outPixels, idx - curW))!;
              const TL = (yield* get(outPixels, idx - curW - 1))!;
              const TR = (yield* get(outPixels, idx - curW + 1))!;
              switch (mode) {
                case 0:
                  pred = 0xff000000;
                  break;
                case 1:
                  pred = L;
                  break;
                case 2:
                  pred = T;
                  break;
                case 3:
                  pred = TR;
                  break;
                case 4:
                  pred = TL;
                  break;
                case 5:
                  pred = avg2(avg2(L, TR), T);
                  break;
                case 6:
                  pred = avg2(L, TL);
                  break;
                case 7:
                  pred = avg2(L, T);
                  break;
                case 8:
                  pred = avg2(TL, T);
                  break;
                case 9:
                  pred = avg2(T, TR);
                  break;
                case 10:
                  pred = avg2(avg2(L, TL), avg2(T, TR));
                  break;
                case 11:
                  pred = selectPred(L, T, TL);
                  break;
                case 12:
                  pred = clampAddSubtractFull(L, T, TL);
                  break;
                case 13:
                  pred = clampAddSubtractHalf(L, T, TL);
                  break;
                default:
                  pred = L;
                  break;
              }
            }
            yield* put(outPixels, idx, addArgb((yield* get(outPixels, idx))!, pred));
          }
        }
      }
    }
    return outPixels;
  }
  return yield* decodeSubImage(width, height, true);
}
