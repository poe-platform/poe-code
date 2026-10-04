import { PagedStorage } from "@poe-code/safe-fs/storage";
import { IndexedDocument, closeDocumentResources } from "safe-bash-diff-engine/document";
import { Budget, ToolError } from "safe-bash-diff-engine/shared";
import type { DiffFlags } from "./diff-options.js";
import { quoteDiffArgument, quoteDiffName } from "./diff-output.js";

interface Group { oldStart: number; newStart: number; oldCount: number; newCount: number }
export interface StdinDocument { document?: IndexedDocument; loading?: Promise<void> }

type Append = (bytes: Uint8Array) => Promise<void>;
const encoder = new TextEncoder();

/** LCS cells and edit groups live in caller storage; only scalar cursors stay in RAM. */
async function buildGroups(old: IndexedDocument, next: IndexedDocument, matrix: PagedStorage, groups: PagedStorage, budget: Budget): Promise<number> {
  let prefix = 0, suffix = 0, count = 0;
  while (prefix < Math.min(old.length, next.length) && await old.equal(prefix, next, prefix)) prefix++;
  if (prefix === old.length && prefix === next.length) return 0;
  budget.countLines(old.length + next.length);
  while (suffix < Math.min(old.length, next.length) - prefix
    && await old.equal(old.length - suffix - 1, next, next.length - suffix - 1)) suffix++;
  const oldCount = old.length - prefix - suffix, newCount = next.length - prefix - suffix;
  const width = newCount + 1, cells = (oldCount + 1) * width;
  if (oldCount && newCount && (cells > budget.limits.maxMatrixCells || !Number.isSafeInteger(cells * 4))) throw new ToolError("diff matrix cell limit exceeded");
  const base = oldCount && newCount ? matrix.allocate(cells * 4) : 0;
  const get = async (row: number, column: number): Promise<number> => {
    const bytes = await matrix.read(base + (row * width + column) * 4, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  };
  const cell = new Uint8Array(4), view = new DataView(cell.buffer);
  for (let row = oldCount - 1; row >= 0 && newCount; row--) {
    for (let column = newCount - 1; column >= 0; column--) {
      budget.step();
      const value = await old.equal(prefix + row, next, prefix + column)
        ? 1 + await get(row + 1, column + 1) : Math.max(await get(row + 1, column), await get(row, column + 1));
      view.setUint32(0, value, true);
      await matrix.write(base + (row * width + column) * 4, cell);
      const checkpoint = budget.checkpoint();
      if (checkpoint) await checkpoint;
    }
  }
  let row = 0, column = 0;
  let group: Group | undefined;
  const flush = async () => {
    if (!group) return;
    const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
    view.setFloat64(0, group.oldStart, true); view.setFloat64(8, group.newStart, true);
    view.setFloat64(16, group.oldCount, true); view.setFloat64(24, group.newCount, true);
    await groups.append(bytes);
    count++;
    group = undefined;
  };
  while (row < oldCount || column < newCount) {
    budget.step();
    if (row < oldCount && column < newCount && await old.equal(prefix + row, next, prefix + column)) {
      await flush(); row++; column++;
    } else {
      group ??= { oldStart: prefix + row, newStart: prefix + column, oldCount: 0, newCount: 0 };
      if (row < oldCount && (column === newCount || await get(row + 1, column) >= await get(row, column + 1))) {
        row++; group.oldCount++;
      } else { column++; group.newCount++; }
    }
    const checkpoint = budget.checkpoint();
    if (checkpoint) await checkpoint;
  }
  await flush();
  return count;
}

function range(start: number, count: number, unified = false): string {
  return count === 0 ? `${start}${unified ? ",0" : ""}` : count === 1 ? `${start + 1}` : `${start + 1},${unified ? count : start + count}`;
}

async function line(document: IndexedDocument, position: number, prefix: string, append: Append): Promise<void> {
  const bounds = await document.line(position);
  await append(encoder.encode(prefix));
  for await (const bytes of document.range(bounds.start, bounds.end)) await append(bytes);
  const last = await document.data.read(8 + bounds.end - 1, 1);
  if (last[0] !== 10) await append(encoder.encode("\n\\ No newline at end of file\n"));
}

export async function indexedDiff(budget: Budget, options: DiffFlags, left: string, right: string, nested: boolean, append: Append,
  sources: { left: string | undefined; right: string | undefined }, stdin: StdinDocument): Promise<boolean> {
  const acquire = (source: string | undefined) => source === "-" ? stdin.document ??= new IndexedDocument(budget) : new IndexedDocument(budget);
  const old = acquire(sources.left), next = acquire(sources.right);
  const load = async (document: IndexedDocument, source: string | undefined) => {
    if (source === "-") await (stdin.loading ??= document.load(budget.stdinSource()));
    else if (source !== undefined) await document.load(budget.diffSource(source));
  };
  const matrix = new PagedStorage(budget.context, 8), groups = new PagedStorage(budget.context, 16);
  budget.context.registerCleanup?.(() => matrix.close());
  budget.context.registerCleanup?.(() => groups.close());
  const text = async (value: string) => { await append(encoder.encode(value)); };
  const group = async (index: number): Promise<Group> => {
    const bytes = await groups.read(8 + index * 32, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { oldStart: view.getFloat64(0, true), newStart: view.getFloat64(8, true), oldCount: view.getFloat64(16, true), newCount: view.getFloat64(24, true) };
  };
  try {
    await load(old, sources.left);
    await load(next, sources.right);
    if (!options.text && (old.binary || next.binary)) {
      let same = old.size === next.size && old.length === next.length;
      for (let index = 0; same && index < old.length; index++) same = await old.equal(index, next, index);
      if (!same) await text(`Binary files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      else if (options.reportSame) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return !same;
    }
    const count = await buildGroups(old, next, matrix, groups, budget);
    if (!count) {
      if (options.format === "ifdef") for await (const bytes of old.range(0, old.size)) await append(bytes);
      if (options.reportSame) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return false;
    }
    if (nested) await text(["diff", ...options.optionArgs.map(quoteDiffArgument), quoteDiffName(options.labels[0] ?? left), quoteDiffName(options.labels[1] ?? right)].join(" ") + "\n");
    if (options.format === "normal") {
      for (let index = 0; index < count; index++) {
        const change = await group(index);
        budget.hunk();
        await text(`${range(change.oldStart, change.oldCount)}${change.oldCount === 0 ? "a" : change.newCount === 0 ? "d" : "c"}${range(change.newStart, change.newCount)}\n`);
        for (let row = 0; row < change.oldCount; row++) await line(old, change.oldStart + row, "< ", append);
        if (change.oldCount && change.newCount) await text("---\n");
        for (let row = 0; row < change.newCount; row++) await line(next, change.newStart + row, "> ", append);
      }
      return true;
    }
    if (options.format === "rcs" || options.format === "ifdef") {
      let position = 0;
      for (let index = 0; index < count; index++) {
        const change = await group(index);
        budget.hunk();
        const oldStart = change.oldStart < old.length ? (await old.line(change.oldStart)).start : old.size;
        const oldEnd = change.oldCount ? (await old.line(change.oldStart + change.oldCount - 1)).end : oldStart;
        const newStart = change.newStart < next.length ? (await next.line(change.newStart)).start : next.size;
        const newEnd = change.newCount ? (await next.line(change.newStart + change.newCount - 1)).end : newStart;
        if (options.format === "rcs") {
          if (change.oldCount) await text(`d${change.oldStart + 1} ${change.oldCount}\n`);
          if (change.newCount) {
            await text(`a${change.oldStart + change.oldCount} ${change.newCount}\n`);
            for await (const bytes of next.range(newStart, newEnd)) await append(bytes);
          }
        } else {
          for await (const bytes of old.range(position, oldStart)) await append(bytes);
          await text(`#if${change.oldCount ? "n" : ""}def ${options.symbol}\n`);
          for await (const bytes of old.range(oldStart, oldEnd)) await append(bytes);
          if (change.oldCount && change.newCount) await text(`#else /* ${options.symbol} */\n`);
          for await (const bytes of next.range(newStart, newEnd)) await append(bytes);
          await text(`#endif /* ${change.oldCount && !change.newCount ? "! " : ""}${options.symbol} */\n`);
          position = oldEnd;
        }
      }
      if (options.format === "ifdef") for await (const bytes of old.range(position, old.size)) await append(bytes);
      return true;
    }
    const unified = options.format === "unified";
    await text(`${unified ? "---" : "***"} ${options.labels[0] ?? quoteDiffName(sources.left === undefined ? "/dev/null" : left)}\n${unified ? "+++" : "---"} ${options.labels[1] ?? quoteDiffName(sources.right === undefined ? "/dev/null" : right)}\n`);
    for (let index = 0; index < count;) {
      const first = await group(index);
      let last = first, end = index + 1;
      while (end < count) {
        const following = await group(end);
        if (following.oldStart - last.oldStart - last.oldCount > 2 * options.context) break;
        last = following; end++;
      }
      const lead = Math.min(options.context, first.oldStart);
      const trail = Math.min(options.context, old.length - last.oldStart - last.oldCount);
      const oldStart = first.oldStart - lead, newStart = first.newStart - lead;
      const oldEnd = last.oldStart + last.oldCount + trail, newEnd = last.newStart + last.newCount + trail;
      budget.hunk();
      if (unified) {
        await text(`@@ -${range(oldStart, oldEnd - oldStart, true)} +${range(newStart, newEnd - newStart, true)} @@\n`);
        let position = oldStart;
        for (let at = index; at < end; at++) {
          const change = await group(at);
          while (position < change.oldStart) await line(old, position++, " ", append);
          for (let row = 0; row < change.oldCount; row++) await line(old, position++, "-", append);
          for (let row = 0; row < change.newCount; row++) await line(next, change.newStart + row, "+", append);
        }
        while (position < oldEnd) await line(old, position++, " ", append);
      } else {
        await text(`***************\n*** ${range(oldStart, oldEnd - oldStart)} ****\n`);
        for (const side of ["old", "new"] as const) {
          if (side === "new") await text(`--- ${range(newStart, newEnd - newStart)} ----\n`);
          let changed = false;
          for (let at = index; at < end; at++) { const change = await group(at); changed ||= (side === "old" ? change.oldCount : change.newCount) > 0; }
          if (!changed) continue;
          const document = side === "old" ? old : next;
          let position = side === "old" ? oldStart : newStart;
          for (let at = index; at < end; at++) {
            const change = await group(at);
            const start = side === "old" ? change.oldStart : change.newStart;
            const length = side === "old" ? change.oldCount : change.newCount;
            while (position < start) await line(document, position++, "  ", append);
            for (let row = 0; row < length; row++) await line(document, position++, change.oldCount && change.newCount ? "! " : side === "old" ? "- " : "+ ", append);
          }
          const limit = side === "old" ? oldEnd : newEnd;
          while (position < limit) await line(document, position++, "  ", append);
        }
      }
      index = end;
    }
    return true;
  } finally {
    await closeDocumentResources([
      ...(old === stdin.document ? [] : [old]),
      ...(next === stdin.document ? [] : [next]), matrix, groups,
    ]);
  }
}
