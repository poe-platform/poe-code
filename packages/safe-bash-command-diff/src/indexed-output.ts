import type { IndexedDocument } from "safe-bash-diff-engine/document";
import { ToolError, type Budget } from "safe-bash-diff-engine/shared";
import { encodeBytes } from "safe-bash-io-engine/byte-encoding";
import type { DiffFlags } from "./diff-options.js";
import { documentText } from "./indexed-normalization.js";

export interface IndexedGroup { oldStart: number; newStart: number; oldCount: number; newCount: number; ignored?: boolean }
type GroupReader = (index: number) => Promise<IndexedGroup>;
type Append = (bytes: Uint8Array) => Promise<void>;

export async function renderEd(next: IndexedDocument, count: number, group: GroupReader, budget: Budget, append: Append): Promise<void> {
  for (let index = count - 1; index >= 0; index--) {
    const change = await group(index);
    budget.hunk();
    if (change.ignored) continue;
    const start = change.oldStart + 1, end = change.oldStart + change.oldCount;
    const range = change.oldCount > 1 ? `${start},${end}` : `${start}`;
    await append(encodeBytes(`${change.oldCount ? range : change.oldStart}${change.oldCount ? change.newCount ? "c" : "d" : "a"}\n`));
    let dot = false;
    for (let row = 0; row < change.newCount; row++) {
      const bounds = await next.line(change.newStart + row);
      dot = bounds.end - bounds.start === 2 && (await next.data.read(8 + bounds.start, 1))[0] === 46;
      if (dot) {
        await append(encodeBytes("..\n.\ns/.//\n"));
        if (row + 1 < change.newCount) await append(encodeBytes("a\n"));
      } else for await (const bytes of next.range(bounds.start, bounds.end)) await append(bytes);
    }
    if (change.newCount && !dot) await append(encodeBytes(".\n"));
  }
}

async function clipped(document: IndexedDocument, position: number, width: number, expand: boolean, utf8: boolean, append: Append): Promise<number> {
  const bounds = await document.line(position);
  let column = 0, pending = "";
  outer: for await (const text of documentText(document, bounds.start, bounds.end, utf8)) {
    for (const character of text) {
      if (character === "\n") break outer;
      const next = character === "\t" ? column + 8 - column % 8 : column + 1;
      if (next > width) break outer;
      pending += character === "\t" && expand ? " ".repeat(next - column) : character;
      column = next;
      if (pending.length >= 4096) { await append(encodeBytes(pending, utf8 ? "utf8" : "latin1")); pending = ""; }
    }
  }
  if (pending) await append(encodeBytes(pending, utf8 ? "utf8" : "latin1"));
  return column;
}

export async function renderSideBySide(old: IndexedDocument, next: IndexedDocument, count: number, group: GroupReader, options: DiffFlags, budget: Budget, append: Append): Promise<void> {
  let half = Math.max(0, Math.floor((options.width - 3) / 2)), rightStart = options.width - half;
  if (!options.expand) {
    rightStart = Math.floor((options.width + 11) / 16) * 8;
    half = Math.max(0, Math.min(rightStart - 3, options.width - rightStart));
    if (half === 0) rightStart = options.width;
  }
  const markerColumn = Math.max(0, Math.floor((half + rightStart - 1) / 2));
  const utf8 = old.validUtf8 && next.validUtf8;
  const padding = async (column: number, target: number) => {
    const tabs = options.expand ? 0 : Math.max(0, Math.floor(target / 8) - Math.floor(column / 8));
    const spaces = Math.max(0, target - (tabs ? (Math.floor(column / 8) + tabs) * 8 : column));
    for (const [character, total] of [["\t", tabs], [" ", spaces]] as const) {
      for (let offset = 0; offset < total; offset += 4096) {
        const size = Math.min(4096, total - offset);
        budget.step(size);
        const checkpoint = budget.checkpoint();
        if (checkpoint) await checkpoint;
        await append(encodeBytes(character.repeat(size)));
      }
    }
  };
  const terminated = async (document: IndexedDocument, position: number | undefined) => {
    if (position === undefined) return false;
    const bounds = await document.line(position);
    return (await document.data.read(8 + bounds.end - 1, 1))[0] === 10;
  };
  const row = async (left: number | undefined, right: number | undefined, common: boolean) => {
    if (common && left !== undefined && right !== undefined && options.suppressCommon) return;
    if (options.width > budget.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
    const leftLf = await terminated(old, left), rightLf = await terminated(next, right);
    const marker = common ? left === undefined ? ")" : right === undefined ? "(" : " "
      : left === undefined ? ">" : right === undefined ? "<" : !leftLf && rightLf ? "\\" : leftLf && !rightLf ? "/" : "|";
    const colored = options.color && (marker === "<" || marker === ">");
    if (colored) await append(encodeBytes(`\u001b[${marker === "<" ? 31 : 32}m`));
    const column = left === undefined ? 0 : await clipped(old, left, half, options.expand, utf8, append);
    if (marker === " " && options.leftColumn) {
      await padding(column, markerColumn);
      await append(encodeBytes("(" + (leftLf ? "\n" : "")));
      return;
    }
    if (marker !== " ") { await padding(column, markerColumn); await append(encodeBytes(marker)); }
    if (right !== undefined) {
      const bounds = await next.line(right);
      if (bounds.end - bounds.start > Number(rightLf)) {
        await padding(marker === " " ? column : markerColumn + 1, rightStart);
        await clipped(next, right, half, options.expand, utf8, append);
      }
    }
    if (leftLf || rightLf) await append(encodeBytes("\n"));
    if (colored) await append(encodeBytes("\u001b[0m"));
  };
  let oldPosition = 0, newPosition = 0;
  for (let index = 0; index <= count;) {
    let change: IndexedGroup | undefined;
    while (index < count) {
      const candidate = await group(index++);
      if (!candidate.ignored) { change = candidate; break; }
    }
    const oldEnd = change?.oldStart ?? old.length, newEnd = change?.newStart ?? next.length;
    while (oldPosition < oldEnd || newPosition < newEnd) {
      await row(oldPosition < oldEnd ? oldPosition++ : undefined, newPosition < newEnd ? newPosition++ : undefined, true);
    }
    if (!change) break;
    budget.hunk();
    for (let offset = 0; offset < Math.max(change.oldCount, change.newCount); offset++) {
      await row(offset < change.oldCount ? change.oldStart + offset : undefined,
        offset < change.newCount ? change.newStart + offset : undefined, false);
    }
    oldPosition = change.oldStart + change.oldCount;
    newPosition = change.newStart + change.newCount;
  }
}
