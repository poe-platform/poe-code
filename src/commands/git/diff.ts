import { quote, type Arguments } from "./arguments.js";
import type { Session } from "./io.js";
import { demand } from "./limits.js";
import type { Repository } from "./repository.js";

export interface Side { readonly mode: number; readonly oid: string; readonly bytes: Buffer }
interface Edit { readonly kind: " " | "+" | "-"; readonly text: string }

async function lines(session: Session, bytes: Buffer): Promise<string[]> {
  const text = session.text(bytes);
  const result: string[] = [];
  let start = 0;
  for (let position = 0; position < text.length; position++) {
    await session.step();
    demand(text.charCodeAt(position) !== 0, "binary Git patches unsupported");
    if (text[position] === "\n") {
      session.charge("maxLines", 1); session.reserve(24);
      result.push(text.slice(start, position + 1)); start = position + 1;
    }
  }
  if (start < text.length) { session.charge("maxLines", 1); session.reserve(24); result.push(text.slice(start)); }
  return result;
}

async function edits(session: Session, before: string[], after: string[]): Promise<Edit[]> {
  const equal = async (left: string, right: string): Promise<boolean> => {
    await session.step(Math.min(left.length, right.length) + 1); return left === right;
  };
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && await equal(before[prefix]!, after[prefix]!)) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && await equal(before[before.length - suffix - 1]!, after[after.length - suffix - 1]!)) suffix++;
  const rows = before.length - prefix - suffix, columns = after.length - prefix - suffix;
  session.reserve((before.length + after.length) * 24);
  const result: Edit[] = before.slice(0, prefix).map(text => ({ kind: " ", text }));
  const cells = (rows + 1) * (columns + 1);
  session.charge("maxDiffCells", cells);
  const storage = session.allocate(cells * 4);
  const grid = new Uint32Array(storage.buffer, storage.byteOffset, cells);
  try {
    for (let row = rows - 1; row >= 0; row--) for (let column = columns - 1; column >= 0; column--) {
      const index = row * (columns + 1) + column;
      grid[index] = await equal(before[prefix + row]!, after[prefix + column]!) ? grid[index + columns + 2]! + 1 : Math.max(grid[index + columns + 1]!, grid[index + 1]!);
    }
    let row = 0, column = 0;
    while (row < rows || column < columns) {
      await session.step();
      if (row < rows && column < columns && await equal(before[prefix + row]!, after[prefix + column]!)) {
        result.push({ kind: " ", text: before[prefix + row++]! }); column++;
      } else if (row < rows && (column === columns || grid[(row + 1) * (columns + 1) + column]! >= grid[row * (columns + 1) + column + 1]!)) result.push({ kind: "-", text: before[prefix + row++]! });
      else result.push({ kind: "+", text: after[prefix + column++]! });
    }
    for (let offset = before.length - suffix; offset < before.length; offset++) result.push({ kind: " ", text: before[offset]! });
    return result;
  } finally { session.release(storage); }
}

function range(start: number, count: number): string { return count === 1 ? String(start) : `${count === 0 ? start - 1 : start},${count}`; }

export async function patch(repository: Repository, parsed: Arguments, path: string, before: Side | undefined, after: Side | undefined): Promise<void> {
  const session = repository.session;
  if (before && after && (before.mode & 0o170000) !== (after.mode & 0o170000)) {
    await patch(repository, parsed, path, before, undefined);
    await patch(repository, parsed, path, undefined, after);
    return;
  }
  const original = before ? await lines(session, before.bytes) : [];
  const replacement = after ? await lines(session, after.bytes) : [];
  const changes = await edits(session, original, replacement);
  await session.output(`diff --git ${quote("a/" + path)} ${quote("b/" + path)}\n`);
  if (!before) await session.output(`new file mode ${after!.mode.toString(8)}\n`);
  else if (!after) await session.output(`deleted file mode ${before.mode.toString(8)}\n`);
  else if (before.mode !== after.mode) await session.output(`old mode ${before.mode.toString(8)}\nnew mode ${after.mode.toString(8)}\n`);
  if (before?.oid === after?.oid) return;
  const abbreviation = async (side: Side | undefined): Promise<string> => side ? parsed.flags.has("--full-index") ? side.oid : repository.abbreviation(side.oid) : "0".repeat(parsed.flags.has("--full-index") ? 40 : 7);
  await session.output(`index ${await abbreviation(before)}..${await abbreviation(after)}${before && after && before.mode === after.mode ? " " + before.mode.toString(8) : ""}\n`);
  if (!changes.some(edit => edit.kind !== " ")) return;
  await session.output(`--- ${before ? quote("a/" + path) : "/dev/null"}\n+++ ${after ? quote("b/" + path) : "/dev/null"}\n`);
  const spans: { start: number; end: number }[] = [];
  for (let offset = 0; offset < changes.length; offset++) {
    await session.step();
    if (changes[offset]!.kind === " ") continue;
    const start = Math.max(0, offset - parsed.context), end = Math.min(changes.length, offset + parsed.context + 1);
    const last = spans.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else spans.push({ start, end });
  }
  let offset = 0, oldLine = 1, newLine = 1;
  for (const span of spans) {
    while (offset < span.start) { const edit = changes[offset++]!; if (edit.kind !== "+") oldLine++; if (edit.kind !== "-") newLine++; }
    let oldCount = 0, newCount = 0;
    for (let position = span.start; position < span.end; position++) { if (changes[position]!.kind !== "+") oldCount++; if (changes[position]!.kind !== "-") newCount++; }
    await session.output(`@@ -${range(oldLine, oldCount)} +${range(newLine, newCount)} @@\n`);
    while (offset < span.end) {
      const edit = changes[offset++]!;
      await session.output(edit.kind + edit.text + (edit.text.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"));
      if (edit.kind !== "+") oldLine++; if (edit.kind !== "-") newLine++;
    }
  }
}
