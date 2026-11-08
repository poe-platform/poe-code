import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { IndexedDocument } from 'safe-bash-diff-engine/document';
import { Diff3Error, type Diff3Options } from './contracts.js';
import { Edits, Numbers, StoredWork, bodyEnd, equalStoredLines, storedLine } from './stored.js';

async function equivalences(files: readonly IndexedDocument[], options: Diff3Options, work: StoredWork): Promise<Numbers[]> {
  const buckets = new IntegerTable(work.storage, 256);
  const count = files.reduce((sum, file) => sum + file.length, 0);
  const records = new Numbers(work, count * 4);
  let next = 1;
  const result: Numbers[] = [];
  for (let file = 0; file < files.length; file++) {
    const document = files[file]!, keys = new Numbers(work, document.length);
    result.push(keys);
    for (let index = 0; index < document.length; index++) {
      const line = await storedLine(document, index), end = await bodyEnd(line, options);
      let hash = line.terminated ? 2166136261 : 2166136260;
      for await (const bytes of document.range(line.start, end)) {
        for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      }
      const bucket = BigInt(hash), head = Number(await buckets.get(bucket) ?? 0n);
      let match = 0;
      for (let key = head; key; key = await records.get((key - 1) * 4 + 3)) {
        const offset = (key - 1) * 4;
        if (hash !== await records.get(offset)) continue;
        const other = await storedLine(files[await records.get(offset + 1)]!, await records.get(offset + 2));
        if (await equalStoredLines(line, other, options, work)) { match = key; break; }
      }
      if (!match) {
        match = next++;
        const values = [hash, file, index, head];
        for (let i = 0; i < 4; i++) await records.set((match - 1) * 4 + i, values[i]!);
        await buckets.set(bucket, BigInt(match));
      }
      await keys.set(index, match);
    }
  }
  return result;
}

/** The same directional GNU alignment, with every growing vector in caller storage. */
export async function alignStoredPair(base: IndexedDocument, variant: IndexedDocument, options: Diff3Options, work: StoredWork): Promise<Edits> {
  const total = base.length + variant.length, previousCells = work.graphCells;
  const edits = new Edits(work, total);
  try {
    if (total > 0x3fff_ffff) throw new Diff3Error('LIMIT', 'Signed edit graph index limit exceeded', 'graphCells');
    work.admit('graphCells', 24 * total + 16); work.step(total);
    if (total === 0) return edits;
    const [allA, allB] = await equivalences([variant, base], options, work) as [Numbers, Numbers];
    let prefix = 0, suffix = 0;
    while (prefix < Math.min(allA.length, allB.length) && await allA.get(prefix) === await allB.get(prefix)) { work.step(); prefix++; }
    if (prefix === allA.length && prefix === allB.length) return edits;
    while (suffix < Math.min(allA.length, allB.length) - prefix && await allA.get(allA.length - suffix - 1) === await allB.get(allB.length - suffix - 1)) { work.step(); suffix++; }
    const low = Math.max(0, prefix - 100), highA = Math.min(allA.length, allA.length - suffix + 100), highB = Math.min(allB.length, allB.length - suffix + 100);
    const keys = [allA.slice(low, highA), allB.slice(low, highB)];
    const changed = keys.map(list => new Numbers(work, list.length + 1));
    const [a, b] = await discard(keys, changed, total, work) as [Reduced, Reduced];
    const width = a.length + b.length + 3, origin = b.length + 1;
    const forward = new Numbers(work, width), backward = new Numbers(work, width);
    const pending = new Numbers(work, (total + 1) * 4);
    let pendingLength = 0;
    const push = async (x0: number, x1: number, y0: number, y1: number) => {
      for (const value of [x0, x1, y0, y1]) await pending.set(pendingLength++, value);
    };
    await push(0, a.length, 0, b.length);
    while (pendingLength) {
      work.step();
      const yEnd = await pending.get(--pendingLength), yStart = await pending.get(--pendingLength);
      const xEnd = await pending.get(--pendingLength), xStart = await pending.get(--pendingLength);
      let x0 = xStart, x1 = xEnd, y0 = yStart, y1 = yEnd;
      while (x0 < x1 && y0 < y1 && await a.keys.get(x0) === await b.keys.get(y0)) { work.step(); x0++; y0++; }
      while (x0 < x1 && y0 < y1 && await a.keys.get(x1 - 1) === await b.keys.get(y1 - 1)) { work.step(); x1--; y1--; }
      if (x0 === x1 || y0 === y1) {
        for (let x = x0; x < x1; x++) { work.step(); await changed[0]!.set(await a.indices.get(x), 1); }
        for (let y = y0; y < y1; y++) { work.step(); await changed[1]!.set(await b.indices.get(y), 1); }
        continue;
      }
      const [x, y] = await midpoint(x0, x1, y0, y1, a, b, forward, backward, origin, work);
      if ((x === x0 && y === y0) || (x === x1 && y === y1)) throw new Diff3Error('ALIGNMENT', 'Non-progressing comparison partition');
      await push(x, x1, y, y1); await push(x0, x, y0, y);
    }
    await shift(keys, changed, work);
    let x = 0, y = 0;
    while (x < keys[0]!.length || y < keys[1]!.length) {
      work.step();
      if (await changed[0]!.get(x) || await changed[1]!.get(y)) {
        const startX = x, startY = y;
        while (await changed[0]!.get(x)) { work.step(); x++; }
        while (await changed[1]!.get(y)) { work.step(); y++; }
        work.admit('graphCells', 4);
        await edits.push({ base: { start: low + startY, end: low + y }, variant: { start: low + startX, end: low + x } });
      } else { x++; y++; }
    }
    return edits;
  } finally { work.graphCells = previousCells + edits.length * 4; }
}

interface Reduced { keys: Numbers; indices: Numbers; length: number }
async function discard(keys: Numbers[], changed: Numbers[], total: number, work: StoredWork): Promise<Reduced[]> {
  const counts = keys.map(() => new Numbers(work, total + 1));
  for (let file = 0; file < 2; file++) {
    for (let i = 0; i < keys[file]!.length; i++) {
      work.step(); const key = await keys[file]!.get(i);
      await counts[file]!.set(key, await counts[file]!.get(key) + 1);
    }
  }
  const results: Reduced[] = [];
  for (let file = 0; file < 2; file++) {
    const list = keys[file]!, marks = new Numbers(work, list.length);
    const threshold = 5 * 2 ** Math.max(0, Math.floor(Math.log2(Math.max(1, list.length)) / 2) - 3);
    for (let i = 0; i < list.length; i++) {
      work.step(); const count = await counts[1 - file]!.get(await list.get(i));
      await marks.set(i, count === 0 ? 1 : count > threshold ? 2 : 0);
    }
    for (let start = 0; start < marks.length;) {
      work.step();
      if (await marks.get(start) !== 1) { if (await marks.get(start) === 2) await marks.set(start, 0); start++; continue; }
      let end = start + 1;
      while (end < marks.length && await marks.get(end) !== 0) { work.step(); end++; }
      while (await marks.get(end - 1) === 2) { work.step(); await marks.set(--end, 0); }
      let provisional = 0;
      for (let i = start; i < end; i++) { work.step(); provisional += Number(await marks.get(i) === 2); }
      const length = end - start;
      if (provisional > Math.floor(length / 4)) {
        for (let i = start; i < end; i++) { work.step(); if (await marks.get(i) === 2) await marks.set(i, 0); }
      } else {
        const minimum = length < 4 ? 2 : 2 ** (Math.floor(Math.log2(length) / 2) - 1) + 1;
        for (let i = start; i < end;) {
          work.step();
          if (await marks.get(i) !== 2) { i++; continue; }
          let j = i + 1;
          while (j < end && await marks.get(j) === 2) { work.step(); j++; }
          if (j - i >= minimum) for (let k = i; k < j; k++) { work.step(); await marks.set(k, 0); }
          i = j;
        }
        for (const direction of [1, -1]) {
          let consecutive = 0;
          for (let distance = 0; distance < length; distance++) {
            work.step(); const i = direction === 1 ? start + distance : end - distance - 1;
            if (distance >= 8 && await marks.get(i) === 1) break;
            if (await marks.get(i) === 2) { await marks.set(i, 0); consecutive = 0; }
            else consecutive = await marks.get(i) === 1 ? consecutive + 1 : 0;
            if (consecutive === 3) break;
          }
        }
      }
      start = end;
    }
    const result: Reduced = { keys: new Numbers(work, list.length), indices: new Numbers(work, list.length), length: 0 };
    for (let index = 0; index < list.length; index++) {
      work.step();
      if (await marks.get(index)) await changed[file]!.set(index, 1);
      else { await result.keys.set(result.length, await list.get(index)); await result.indices.set(result.length, index); result.length++; }
    }
    results.push(result);
  }
  return results;
}

async function midpoint(x0: number, x1: number, y0: number, y1: number, a: Reduced, b: Reduced, f: Numbers, r: Numbers, origin: number, work: StoredWork): Promise<[number, number]> {
  const first = x0 - y0, last = x1 - y1, min = x0 - y1, max = x1 - y0;
  let fLow = first, fHigh = first, rLow = last, rHigh = last;
  await f.set(origin + first, x0); await r.set(origin + last, x1);
  const odd = (first - last) % 2 !== 0;
  for (;;) {
    work.step();
    if (fLow > min) { fLow--; await f.set(origin + fLow - 1, -1); } else fLow++;
    if (fHigh < max) { fHigh++; await f.set(origin + fHigh + 1, -1); } else fHigh--;
    for (let diagonal = fHigh; diagonal >= fLow; diagonal -= 2) {
      work.step(); const left = await f.get(origin + diagonal - 1), right = await f.get(origin + diagonal + 1);
      let x = left < right ? right : left + 1, y = x - diagonal;
      while (x < x1 && y < y1 && await a.keys.get(x) === await b.keys.get(y)) { work.step(); x++; y++; }
      await f.set(origin + diagonal, x);
      if (odd && diagonal >= rLow && diagonal <= rHigh && await r.get(origin + diagonal) <= x) return [x, y];
    }
    if (rLow > min) { rLow--; await r.set(origin + rLow - 1, 0x7fff_ffff); } else rLow++;
    if (rHigh < max) { rHigh++; await r.set(origin + rHigh + 1, 0x7fff_ffff); } else rHigh--;
    for (let diagonal = rHigh; diagonal >= rLow; diagonal -= 2) {
      work.step(); const left = await r.get(origin + diagonal - 1), right = await r.get(origin + diagonal + 1);
      let x = left < right ? left : right - 1, y = x - diagonal;
      while (x > x0 && y > y0 && await a.keys.get(x - 1) === await b.keys.get(y - 1)) { work.step(); x--; y--; }
      await r.set(origin + diagonal, x);
      if (!odd && diagonal >= fLow && diagonal <= fHigh && x <= await f.get(origin + diagonal)) return [x, y];
    }
  }
}

async function shift(keys: Numbers[], changed: Numbers[], work: StoredWork): Promise<void> {
  for (let file = 0; file < 2; file++) {
    const list = keys[file]!, own = changed[file]!, other = changed[1 - file]!;
    let i = 0, j = 0;
    while (i < list.length) {
      work.step();
      if (!await own.get(i)) { while (await other.get(j)) { work.step(); j++; } i++; j++; continue; }
      let start = i;
      while (await own.get(i)) { work.step(); i++; }
      while (await other.get(j)) { work.step(); j++; }
      let corresponding: number, length: number;
      do {
        work.step(); length = i - start;
        while (start > 0 && await list.get(start - 1) === await list.get(i - 1)) {
          work.step(); await own.set(--start, 1); await own.set(--i, 0);
          while (start > 0 && await own.get(start - 1)) { work.step(); start--; }
          do { work.step(); j--; } while (j >= 0 && await other.get(j));
        }
        corresponding = await other.get(j - 1) ? i : list.length;
        while (i < list.length && await list.get(start) === await list.get(i)) {
          work.step(); await own.set(start++, 0); await own.set(i++, 1);
          while (await own.get(i)) { work.step(); i++; }
          do { work.step(); j++; if (await other.get(j)) corresponding = i; } while (await other.get(j));
        }
      } while (length !== i - start);
      while (corresponding < i) {
        work.step(); await own.set(--start, 1); await own.set(--i, 0);
        do { work.step(); j--; } while (j >= 0 && await other.get(j));
      }
    }
  }
}
