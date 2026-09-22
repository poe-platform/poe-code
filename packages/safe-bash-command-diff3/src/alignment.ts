import { Diff3Error, type Diff3Edit, type Diff3Line, type Diff3Options } from './contracts.js';
import type { Budget } from './budget.js';
import { bodyLength, equalLines } from './comparison.js';
import { assertAlignmentCost } from './profile.js';

function equivalences(files: readonly (readonly Diff3Line[])[], options: Diff3Options, budget: Budget): number[][] {
  const buckets = new Map<number, { line: Diff3Line; key: number }[]>();
  let next = 1;
  return files.map(lines => lines.map(line => {
    let hash = line.terminated ? 2166136261 : 2166136260;
    const size = bodyLength(line, options);
    for (let i = 0; i < size; i++) { budget.admit('work', 1); hash = Math.imul(hash ^ line.bytes[i]!, 16777619) >>> 0; }
    const bucket = buckets.get(hash) ?? [];
    for (const entry of bucket) if (equalLines(line, entry.line, options, budget)) return entry.key;
    bucket.push({ line, key: next }); buckets.set(hash, bucket); return next++;
  }));
}

/** First-party bidirectional edit graph with the released horizon/tie profile. */
export function alignPair(base: readonly Diff3Line[], variant: readonly Diff3Line[], options: Diff3Options, budget: Budget): Diff3Edit[] {
  const previousCells = budget.graphCells, edits: Diff3Edit[] = [];
  try {
    const total = base.length + variant.length;
    if (total > 0x3fff_ffff) throw new Diff3Error('LIMIT', 'Signed edit graph index limit exceeded', 'graphCells');
    // Conservative simultaneous cell reservation: keys, hash/count/index
    // slots, flags, reduced vectors, two frontiers and partition stack.
    budget.admit('graphCells', 24 * total + 16); budget.admit('work', total);
    // diff3 compares each variant TO the selected common operand. Midpoint
    // ties are directional; invert the resulting ranges, not the comparison.
    const [allA, allB] = equivalences([variant, base], options, budget) as [number[], number[]];
    let prefix = 0, suffix = 0;
    while (prefix < Math.min(allA.length, allB.length) && allA[prefix] === allB[prefix]) { budget.admit('work', 1); prefix++; }
    if (prefix === allA.length && prefix === allB.length) return edits;
    while (suffix < Math.min(allA.length, allB.length) - prefix && allA[allA.length - suffix - 1] === allB[allB.length - suffix - 1]) { budget.admit('work', 1); suffix++; }
    const low = Math.max(0, prefix - 100), highA = Math.min(allA.length, allA.length - suffix + 100), highB = Math.min(allB.length, allB.length - suffix + 100);
    const keys = [allA.slice(low, highA), allB.slice(low, highB)];
    const changed = keys.map(list => new Uint8Array(list.length + 1));
    const reduced = discard(keys, changed, budget), a = reduced[0]!, b = reduced[1]!;
    const width = a.length + b.length + 3, origin = b.length + 1;
    const forward = new Int32Array(width), backward = new Int32Array(width);
    const pending: number[][] = [[0, a.length, 0, b.length]];
    while (pending.length) {
      budget.admit('work', 1);
      let [x0, x1, y0, y1] = pending.pop()! as [number, number, number, number];
      while (x0 < x1 && y0 < y1 && a[x0]!.key === b[y0]!.key) { budget.admit('work', 1); x0++; y0++; }
      while (x0 < x1 && y0 < y1 && a[x1 - 1]!.key === b[y1 - 1]!.key) { budget.admit('work', 1); x1--; y1--; }
      if (x0 === x1 || y0 === y1) {
        for (let x = x0; x < x1; x++) { budget.admit('work', 1); changed[0]![a[x]!.index] = 1; }
        for (let y = y0; y < y1; y++) { budget.admit('work', 1); changed[1]![b[y]!.index] = 1; }
        continue;
      }
      const [x, y] = midpoint(x0, x1, y0, y1, a, b, forward, backward, origin, budget);
      if ((x === x0 && y === y0) || (x === x1 && y === y1)) throw new Diff3Error('ALIGNMENT', 'Non-progressing comparison partition');
      pending.push([x, x1, y, y1], [x0, x, y0, y]);
    }
    shift(keys, changed, budget);
    let x = 0, y = 0;
    while (x < keys[0]!.length || y < keys[1]!.length) {
      budget.admit('work', 1);
      if (changed[0]![x] || changed[1]![y]) {
        const startX = x, startY = y;
        while (changed[0]![x]) { budget.admit('work', 1); x++; }
        while (changed[1]![y]) { budget.admit('work', 1); y++; }
        budget.admit('graphCells', 4);
        edits.push({ base: { start: low + startY, end: low + y }, variant: { start: low + startX, end: low + x } });
      } else { x++; y++; }
    }
    return edits;
  } finally { budget.graphCells = previousCells + edits.length * 4; }
}

interface IndexedKey { key: number; index: number }
function discard(keys: number[][], changed: Uint8Array[], budget: Budget): IndexedKey[][] {
  const counts = keys.map(list => {
    const result = new Map<number, number>();
    for (const key of list) { budget.admit('work', 1); result.set(key, (result.get(key) ?? 0) + 1); }
    return result;
  });
  return keys.map((list, file) => {
    const threshold = 5 * 2 ** Math.max(0, Math.floor(Math.log2(Math.max(1, list.length)) / 2) - 3);
    const marks = list.map(key => { budget.admit('work', 1); const count = counts[1 - file]!.get(key) ?? 0; return count === 0 ? 1 : count > threshold ? 2 : 0; });
    // Provisional frequent keys survive unless inside a sparse, short subrun
    // bounded by keys wholly absent from the other side.
    for (let start = 0; start < marks.length;) {
      budget.admit('work', 1);
      if (marks[start] !== 1) { if (marks[start] === 2) marks[start] = 0; start++; continue; }
      let end = start + 1;
      while (end < marks.length && marks[end] !== 0) { budget.admit('work', 1); end++; }
      while (marks[end - 1] === 2) { budget.admit('work', 1); marks[--end] = 0; }
      let provisional = 0;
      for (let i = start; i < end; i++) { budget.admit('work', 1); provisional += Number(marks[i] === 2); }
      const length = end - start;
      if (provisional > Math.floor(length / 4)) {
        for (let i = start; i < end; i++) { budget.admit('work', 1); if (marks[i] === 2) marks[i] = 0; }
      } else {
        const minimum = length < 4 ? 2 : 2 ** (Math.floor(Math.log2(length) / 2) - 1) + 1;
        for (let i = start; i < end;) {
          budget.admit('work', 1);
          if (marks[i] !== 2) { i++; continue; }
          let j = i + 1;
          while (j < end && marks[j] === 2) { budget.admit('work', 1); j++; }
          if (j - i >= minimum) for (let k = i; k < j; k++) { budget.admit('work', 1); marks[k] = 0; }
          i = j;
        }
        for (const direction of [1, -1]) {
          let consecutive = 0;
          for (let distance = 0; distance < length; distance++) {
            budget.admit('work', 1);
            const i = direction === 1 ? start + distance : end - distance - 1;
            if (distance >= 8 && marks[i] === 1) break;
            if (marks[i] === 2) { marks[i] = 0; consecutive = 0; }
            else consecutive = marks[i] === 1 ? consecutive + 1 : 0;
            if (consecutive === 3) break;
          }
        }
      }
      start = end;
    }
    const result: IndexedKey[] = [];
    for (let index = 0; index < list.length; index++) {
      budget.admit('work', 1);
      if (marks[index]) changed[file]![index] = 1;
      else result.push({ key: list[index]!, index });
    }
    return result;
  });
}

function midpoint(x0: number, x1: number, y0: number, y1: number, a: IndexedKey[], b: IndexedKey[], f: Int32Array, r: Int32Array, origin: number, budget: Budget): [number, number] {
  const first = x0 - y0, last = x1 - y1, min = x0 - y1, max = x1 - y0;
  let fLow = first, fHigh = first, rLow = last, rHigh = last;
  f[origin + first] = x0; r[origin + last] = x1;
  const odd = (first - last) % 2 !== 0;
  for (let cost = 1;; cost++) {
    budget.admit('work', 1);
    if (fLow > min) { fLow--; f[origin + fLow - 1] = -1; } else fLow++;
    if (fHigh < max) { fHigh++; f[origin + fHigh + 1] = -1; } else fHigh--;
    for (let diagonal = fHigh; diagonal >= fLow; diagonal -= 2) {
      budget.admit('work', 1);
      const left = f[origin + diagonal - 1]!, right = f[origin + diagonal + 1]!;
      let x = left < right ? right : left + 1, y = x - diagonal;
      while (x < x1 && y < y1 && a[x]!.key === b[y]!.key) { budget.admit('work', 1); x++; y++; }
      f[origin + diagonal] = x;
      if (odd && diagonal >= rLow && diagonal <= rHigh && r[origin + diagonal]! <= x) return [x, y];
    }
    if (rLow > min) { rLow--; r[origin + rLow - 1] = 0x7fff_ffff; } else rLow++;
    if (rHigh < max) { rHigh++; r[origin + rHigh + 1] = 0x7fff_ffff; } else rHigh--;
    for (let diagonal = rHigh; diagonal >= rLow; diagonal -= 2) {
      budget.admit('work', 1);
      const left = r[origin + diagonal - 1]!, right = r[origin + diagonal + 1]!;
      let x = left < right ? left : right - 1, y = x - diagonal;
      while (x > x0 && y > y0 && a[x - 1]!.key === b[y - 1]!.key) { budget.admit('work', 1); x--; y--; }
      r[origin + diagonal] = x;
      if (!odd && diagonal >= fLow && diagonal <= fHigh && x <= f[origin + diagonal]!) return [x, y];
    }
    assertAlignmentCost(cost, a.length + b.length + 3);
  }
}

function shift(keys: number[][], changed: Uint8Array[], budget: Budget): void {
  for (let file = 0; file < 2; file++) {
    const list = keys[file]!, own = changed[file]!, other = changed[1 - file]!;
    let i = 0, j = 0;
    while (i < list.length) {
      budget.admit('work', 1);
      if (!own[i]) { while (other[j]) { budget.admit('work', 1); j++; } i++; j++; continue; }
      let start = i;
      while (own[i]) { budget.admit('work', 1); i++; }
      while (other[j]) { budget.admit('work', 1); j++; }
      let corresponding: number, length: number;
      do {
        budget.admit('work', 1); length = i - start;
        while (start > 0 && list[start - 1] === list[i - 1]) {
          budget.admit('work', 1); own[--start] = 1; own[--i] = 0;
          while (start > 0 && own[start - 1]) { budget.admit('work', 1); start--; }
          do { budget.admit('work', 1); j--; } while (j >= 0 && other[j]);
        }
        corresponding = other[j - 1] ? i : list.length;
        while (i < list.length && list[start] === list[i]) {
          budget.admit('work', 1); own[start++] = 0; own[i++] = 1;
          while (own[i]) { budget.admit('work', 1); i++; }
          do { budget.admit('work', 1); j++; if (other[j]) corresponding = i; } while (other[j]);
        }
      } while (length !== i - start);
      while (corresponding < i) {
        budget.admit('work', 1); own[--start] = 1; own[--i] = 0;
        do { budget.admit('work', 1); j--; } while (j >= 0 && other[j]);
      }
    }
  }
}
