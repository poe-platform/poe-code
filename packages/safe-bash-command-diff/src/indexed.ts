import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { renderEd, renderSideBySide, type IndexedGroup as Group } from "./indexed-output.js";
import { comparisonSource, expandedSource, stripTrailingCr, terminatedSource } from "./indexed-normalization.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { IndexedDocument, closeDocumentResources } from "safe-bash-diff-engine/document";
import { Budget, ToolError } from "safe-bash-diff-engine/shared";
import type { DiffFlags } from "./diff-options.js";
import { colorText, quoteDiffArgument, quoteDiffName } from "./diff-output.js";

export interface StdinDocument { document?: IndexedDocument; loading?: Promise<void> }

type DocumentSource = string | { stream: string } | undefined;

type Append = (bytes: Uint8Array) => Promise<void>;
const encoder = new TextEncoder();

/** LCS cells and edit groups live in caller storage with bounded row windows in RAM. */
async function buildGroups(old: IndexedDocument, next: IndexedDocument, matrix: PagedStorage, groups: PagedStorage, budget: Budget, admitLines = true): Promise<number> {
  let prefix = 0, suffix = 0, count = 0;
  while (prefix < Math.min(old.length, next.length) && await old.equal(prefix, next, prefix)) prefix++;
  if (prefix === old.length && prefix === next.length) return 0;
  if (admitLines) budget.countLines(old.length + next.length);
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
  // Retain two bounded row windows; the complete matrix stays in caller storage.
  const rowBytes = new Uint8Array(16 * 1024 - 4), rowView = new DataView(rowBytes.buffer);
  for (let row = oldCount - 1; row >= 0 && newCount; row--) {
    let right = 0;
    for (let end = newCount; end > 0;) {
      const start = Math.max(0, end - rowBytes.length / 4);
      const belowBytes = await matrix.read(base + ((row + 1) * width + start) * 4, (end - start + 1) * 4);
      const below = new DataView(belowBytes.buffer, belowBytes.byteOffset, belowBytes.byteLength);
      for (let column = end - 1; column >= start; column--) {
        const offset = (column - start) * 4;
        // equal charges the cell comparison, including compared payload bytes.
        right = await old.equal(prefix + row, next, prefix + column)
          ? 1 + below.getUint32(offset + 4, true) : Math.max(below.getUint32(offset, true), right);
        rowView.setUint32(offset, right, true);
        const checkpoint = budget.checkpoint();
        if (checkpoint) await checkpoint;
      }
      await matrix.write(base + (row * width + start) * 4, rowBytes.subarray(0, (end - start) * 4));
      end = start;
    }
  }
  let row = 0, column = 0;
  let group: Group | undefined;
  const flush = async () => {
    if (!group) return;
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
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

interface LineOutput { append: Append; options: DiffFlags; utf8: boolean }

async function blank(document: IndexedDocument, position: number, whitespace: boolean): Promise<boolean> {
  const bounds = await document.line(position);
  let end = bounds.end;
  if ((await document.data.read(8 + end - 1, 1))[0] === 10) end--;
  if (!whitespace) return bounds.start === end;
  for await (const bytes of document.range(bounds.start, end)) {
    for (const byte of bytes) if (byte !== 32 && byte !== 9 && byte !== 11 && byte !== 12 && byte !== 13) return false;
  }
  return true;
}

async function line(document: IndexedDocument, position: number, prefix: string, output: LineOutput, color?: 31 | 32): Promise<void> {
  const { append, options, utf8 } = output;
  const bounds = await document.line(position);
  const terminated = (await document.data.read(8 + bounds.end - 1, 1))[0] === 10;
  if (options.initialTab) prefix = (prefix.length === 2 ? prefix.slice(0, -1) : prefix.trimEnd()) + "\t";
  if (options.color && color !== undefined) await append(encoder.encode(`\u001b[${color}m`));
  await append(encoder.encode(prefix));
  const end = bounds.end - Number(terminated);
  const source = options.expand ? expandedSource(document, bounds.start, end, utf8) : document.range(bounds.start, end);
  for await (const bytes of source) await append(bytes);
  if (options.color && color !== undefined) await append(encoder.encode("\u001b[0m"));
  await append(encoder.encode("\n"));
  if (!terminated) await append(encoder.encode("\\ No newline at end of file\n"));
}

export async function indexedDiff(budget: Budget, options: DiffFlags, left: string, right: string, nested: boolean, append: Append,
  sources: { left: DocumentSource; right: DocumentSource }, stdin: StdinDocument): Promise<{ different: boolean; trouble: boolean }> {
  let trouble = false;
  const acquire = (source: DocumentSource) => source === "-" ? stdin.document ??= new IndexedDocument(budget) : new IndexedDocument(budget);
  const rawOld = acquire(sources.left), rawNext = acquire(sources.right);
  let old = rawOld, next = rawNext;
  const load = async (document: IndexedDocument, source: DocumentSource) => {
    if (source === undefined) return;
    const input = source === "-" ? budget.stdinSource() : typeof source === "string" ? budget.diffSource(source) : budget.streamSource(source.stream);
    if (source === "-") await (stdin.loading ??= document.load(input));
    else await document.load(input);
  };
  const keys: IndexedDocument[] = [];
  const matrix = new PagedStorage(budget.context, 8), groups = new PagedStorage(budget.context, 16);
  budget.context.registerCleanup?.(() => matrix.close());
  budget.context.registerCleanup?.(() => groups.close());
  const text = async (value: string, color?: 1 | 36) => { await append(encoder.encode(color === undefined ? value : colorText(value, color, options))); };
  const group = async (index: number): Promise<Group> => {
    const bytes = await groups.read(8 + index * 40, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { oldStart: view.getFloat64(0, true), newStart: view.getFloat64(8, true), oldCount: view.getFloat64(16, true), newCount: view.getFloat64(24, true), ignored: !!view.getUint8(32) };
  };
  try {
    await load(old, sources.left);
    await load(next, sources.right);
    if (!options.text && (old.binary || next.binary)) {
      let same = old.size === next.size && old.length === next.length;
      for (let index = 0; same && index < old.length; index++) same = await old.equal(index, next, index);
      if (!same) await text(`${options.brief ? "Files" : "Binary files"} ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      else if (options.reportSame) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return { different: !same, trouble };
    }
    if (options.format === "ed" && !options.brief) {
      for (const [document, path] of [[old, left], [next, right]] as const) {
        if (document.size && (await document.data.read(8 + document.size - 1, 1))[0] !== 10) {
          trouble = true;
          await writeDiagnostic(budget.context.stderr, `diff: ${path}: No newline at end of file\n\n`, budget.context.signal);
        }
      }
    }
    if (options.stripTrailingCr) {
      old = new IndexedDocument(budget); next = new IndexedDocument(budget);
      keys.push(old, next);
      await old.load(stripTrailingCr(rawOld.range(0, rawOld.size), budget.context.signal));
      await next.load(stripTrailingCr(rawNext.range(0, rawNext.size), budget.context.signal));
    }
    if (options.format === "ed" && !options.brief && trouble) {
      const before = old, after = next;
      old = new IndexedDocument(budget); next = new IndexedDocument(budget);
      keys.push(old, next);
      await old.load(terminatedSource(before)); await next.load(terminatedSource(after));
    }
    let oldKeys = old, nextKeys = next;
    const normalize = options.whitespace !== "exact" || options.ignoreCase || options.ignoreTabs || options.ignoreTrailing;
    let sameRaw = false;
    if (normalize) {
      sameRaw = old.size === next.size && old.length === next.length;
      for (let index = 0; sameRaw && index < old.length; index++) sameRaw = await old.equal(index, next, index);
    }
    const counted = options.format === "ifdef" || options.format === "side" || normalize && !sameRaw;
    if (counted) budget.countLines(old.length + next.length);
    if (normalize && !sameRaw) {
      oldKeys = new IndexedDocument(budget); nextKeys = new IndexedDocument(budget);
      keys.push(oldKeys, nextKeys);
      const utf8 = old.validUtf8 && next.validUtf8;
      await oldKeys.load(comparisonSource(old, options, utf8));
      await nextKeys.load(comparisonSource(next, options, utf8));
    }
    if (options.brief && !options.ignoreBlank) {
      let same = oldKeys.size === nextKeys.size && oldKeys.length === nextKeys.length;
      for (let index = 0; same && index < oldKeys.length; index++) same = await oldKeys.equal(index, nextKeys, index);
      if (!same) {
        if (!counted) budget.countLines(old.length + next.length);
        await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      } else if (options.reportSame) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return { different: !same, trouble };
    }
    const render = { append, options, utf8: old.validUtf8 && next.validUtf8 };
    const count = sameRaw ? 0 : await buildGroups(oldKeys, nextKeys, matrix, groups, budget, !counted);
    let visible = count;
    if (options.ignoreBlank) for (let index = 0; index < count; index++) {
      const change = await group(index);
      let ignored = true;
      for (const [document, start, length] of [[old, change.oldStart, change.oldCount], [next, change.newStart, change.newCount]] as const) {
        for (let row = 0; row < length; row++) {
          budget.step();
          const matches = await blank(document, start + row, options.whitespace !== "exact");
          ignored &&= matches;
          const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
        }
      }
      if (ignored) { visible--; await groups.write(8 + index * 40 + 32, new Uint8Array([1])); }
    }
    if (options.brief) {
      if (visible) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      else if (options.reportSame && !trouble) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return { different: visible > 0, trouble };
    }
    if (options.format === "side") {
      if (nested && (visible || !options.suppressCommon)) await text(["diff", ...options.optionArgs.map(quoteDiffArgument), quoteDiffName(options.labels[0] ?? left), quoteDiffName(options.labels[1] ?? right)].join(" ") + "\n");
      if (!nested || visible || !options.suppressCommon) await renderSideBySide(old, next, count, group, options, budget, append);
      if (!visible && options.reportSame && !trouble) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return { different: visible > 0, trouble };
    }
    if (!visible && (options.format !== "ifdef" || !count)) {
      if (options.format === "ifdef") for await (const bytes of old.range(0, old.size)) await append(bytes);
      if (options.reportSame && !trouble) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return { different: false, trouble };
    }
    if (nested && visible) await text(["diff", ...options.optionArgs.map(quoteDiffArgument), quoteDiffName(options.labels[0] ?? left), quoteDiffName(options.labels[1] ?? right)].join(" ") + "\n");
    if (options.format === "ed") {
      await renderEd(next, count, group, budget, append);
      return { different: true, trouble };
    }
    if (options.format === "normal") {
      for (let index = 0; index < count; index++) {
        const change = await group(index);
        budget.hunk();
        if (change.ignored) continue;
        await text(`${range(change.oldStart, change.oldCount)}${change.oldCount === 0 ? "a" : change.newCount === 0 ? "d" : "c"}${range(change.newStart, change.newCount)}\n`, 36);
        for (let row = 0; row < change.oldCount; row++) await line(old, change.oldStart + row, "< ", render, 31);
        if (change.oldCount && change.newCount) await text("---\n");
        for (let row = 0; row < change.newCount; row++) await line(next, change.newStart + row, "> ", render, 32);
      }
      return { different: true, trouble };
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
        if (change.ignored) {
          if (options.format === "ifdef") {
            for await (const bytes of old.range(position, oldEnd)) await append(bytes);
            position = oldEnd;
          }
          continue;
        }
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
      if (!visible && options.reportSame && !trouble) await text(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      return { different: visible > 0, trouble };
    }
    const unified = options.format === "unified";
    await text(`${unified ? "---" : "***"} ${options.labels[0] ?? quoteDiffName(sources.left === undefined ? "/dev/null" : left)}\n`, 1);
    await text(`${unified ? "+++" : "---"} ${options.labels[1] ?? quoteDiffName(sources.right === undefined ? "/dev/null" : right)}\n`, 1);
    for (let index = 0; index < count;) {
      const first = await group(index);
      let last = first, end = index + 1, changed = !first.ignored;
      while (end < count) {
        const following = await group(end);
        const gap = following.oldStart - last.oldStart - last.oldCount;
        if (gap > 2 * options.context || following.ignored && gap >= options.context) break;
        changed ||= !following.ignored;
        last = following; end++;
      }
      if (!changed) { index = end; continue; }
      const lead = Math.min(options.context, first.oldStart);
      const trail = Math.min(options.context, old.length - last.oldStart - last.oldCount);
      const oldStart = first.oldStart - lead, newStart = first.newStart - lead;
      const oldEnd = last.oldStart + last.oldCount + trail, newEnd = last.newStart + last.newCount + trail;
      budget.hunk();
      if (unified) {
        await text(`@@ -${range(oldStart, oldEnd - oldStart, true)} +${range(newStart, newEnd - newStart, true)} @@`, 36);
        await text("\n");
        let position = oldStart;
        for (let at = index; at < end; at++) {
          const change = await group(at);
          while (position < change.oldStart) await line(old, position++, " ", render);
          for (let row = 0; row < change.oldCount; row++) await line(old, position++, "-", render, 31);
          for (let row = 0; row < change.newCount; row++) await line(next, change.newStart + row, "+", render, 32);
        }
        while (position < oldEnd) await line(old, position++, " ", render);
      } else {
        await text("***************\n");
        await text(`*** ${range(oldStart, oldEnd - oldStart)} ****\n`, 36);
        for (const side of ["old", "new"] as const) {
          if (side === "new") await text(`--- ${range(newStart, newEnd - newStart)} ----\n`, 36);
          let changed = false;
          for (let at = index; at < end; at++) { const change = await group(at); changed ||= (side === "old" ? change.oldCount : change.newCount) > 0; }
          if (!changed) continue;
          const document = side === "old" ? old : next;
          let position = side === "old" ? oldStart : newStart;
          for (let at = index; at < end; at++) {
            const change = await group(at);
            const start = side === "old" ? change.oldStart : change.newStart;
            const length = side === "old" ? change.oldCount : change.newCount;
            while (position < start) await line(document, position++, "  ", render, side === "old" ? 31 : 32);
            for (let row = 0; row < length; row++) await line(document, position++, change.oldCount && change.newCount ? "! " : side === "old" ? "- " : "+ ", render, side === "old" ? 31 : 32);
          }
          const limit = side === "old" ? oldEnd : newEnd;
          while (position < limit) await line(document, position++, "  ", render, side === "old" ? 31 : 32);
        }
      }
      index = end;
    }
    return { different: true, trouble };
  } finally {
    await closeDocumentResources([
      ...(rawOld === stdin.document ? [] : [rawOld]),
      ...(rawNext === stdin.document ? [] : [rawNext]), ...keys, matrix, groups,
    ]);
  }
}
