import { ToolError, type Budget } from "./shared.js";
import type { Edit } from "./diff-format.js";

export interface DisplayOptions {
  width: number;
  expand: boolean;
  initialTab: boolean;
  leftColumn: boolean;
  suppressCommon: boolean;
  symbol: string;
}

/** GNU C-locale filename quoting, also used for labels in directory sections. */
export function quoteDiffName(name: string): string {
  let needsQuotes = !name;
  for (const character of name) {
    if (character <= " " || character > "\u007f" || character === '"' || character === "\\") { needsQuotes = true; break; }
  }
  if (!needsQuotes) return name;
  const escapes: Readonly<Record<number, string>> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 34: '\\"', 92: "\\\\" };
  let quoted = '"';
  for (const byte of Buffer.from(name)) {
    quoted += escapes[byte] ?? (byte >= 32 && byte <= 127 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, "0")}`);
  }
  return quoted + '"';
}

/** GNU shell-style quoting for the original option arguments in a header. */
export function quoteDiffArgument(argument: string): string {
  let needsQuotes = !argument || argument === "{" || argument === "}"
    || argument.startsWith("#") || argument.startsWith("~");
  let doubleQuotes = argument.includes("'");
  for (const character of argument) {
    needsQuotes ||= " \t\n\r!\"$&'()*;<=>?[\\^`|".includes(character);
    doubleQuotes &&= " %'+,-./0123456789:@ABCDEFGHIJKLMNOPQRSTUVWXYZ]_abcdefghijklmnopqrstuvwxyz".includes(character);
  }
  if (!needsQuotes) return argument;
  if (doubleQuotes) return `"${argument}"`;
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

export function expandTabs(line: string): string {
  let column = 0;
  let result = "";
  for (const character of line) {
    if (character === "\t") {
      const count = 8 - column % 8;
      result += " ".repeat(count);
      column += count;
    } else {
      result += character;
      if (character === "\r") column = 0;
      else if (character === "\b") column = Math.max(0, column - 1);
      else column++;
    }
  }
  return result;
}

function clipped(line: string, width: number, expand: boolean): { text: string; column: number } {
  let column = 0, text = "";
  for (const character of line) {
    if (character === "\n") break;
    const next = character === "\t" ? column + 8 - column % 8 : column + 1;
    if (next > width) break;
    text += character === "\t" && expand ? " ".repeat(next - column) : character;
    column = next;
  }
  return { text, column };
}

function padding(column: number, target: number, expand: boolean): string {
  let result = "";
  if (!expand) while (column + 8 - column % 8 <= target) {
    result += "\t";
    column += 8 - column % 8;
  }
  return result + " ".repeat(Math.max(0, target - column));
}

export async function sideBySide(changes: readonly Edit[], options: DisplayOptions, budget: Budget, append: (text: string) => void): Promise<void> {
  // GNU aligns the right column to an eight-column tab stop unless -t is used.
  let half = Math.max(0, Math.floor((options.width - 3) / 2));
  let rightStart = options.width - half;
  if (!options.expand) {
    rightStart = Math.floor((options.width + 11) / 16) * 8;
    half = Math.max(0, Math.min(rightStart - 3, options.width - rightStart));
    if (half === 0) rightStart = options.width;
  }
  const markerColumn = Math.max(0, Math.floor((half + rightStart - 1) / 2));
  const row = (left: string | undefined, right: string | undefined, marker: string) => {
    if (marker === " " && options.suppressCommon) return;
    if (options.width > budget.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
    const first = clipped(left ?? "", half, options.expand);
    let text = first.text;
    if (marker === " " && options.leftColumn) {
      append(text + padding(first.column, markerColumn, options.expand) + "(" + (left?.endsWith("\n") ? "\n" : ""));
      return;
    }
    if (marker !== " ") text += padding(first.column, markerColumn, options.expand) + marker;
    if (right !== undefined && right.length > 0 && right !== "\n") {
      const column = marker === " " ? first.column : markerColumn + 1;
      const second = clipped(right, half, options.expand);
      text += padding(column, rightStart, options.expand) + second.text;
    }
    append(text + (left?.endsWith("\n") || right?.endsWith("\n") ? "\n" : ""));
  };
  let scan = 0;
  while (scan < changes.length) {
    budget.step();
    await budget.checkpoint();
    const edit = changes[scan]!;
    if (edit.kind === " " || edit.ignored) {
      const old: string[] = [], next: string[] = [];
      while (scan < changes.length && (changes[scan]!.kind === " " || changes[scan]!.ignored)) {
        const item = changes[scan++]!;
        if (item.kind !== "+") old.push(item.line);
        if (item.kind !== "-") next.push(item.newLine ?? item.line);
        budget.step(1 + item.line.length);
        await budget.checkpoint();
      }
      for (let index = 0; index < Math.max(old.length, next.length); index++) {
        row(old[index], next[index], old[index] === undefined ? ")" : next[index] === undefined ? "(" : " ");
        budget.step();
        await budget.checkpoint();
      }
      continue;
    }
    budget.hunk();
    const old: string[] = [], next: string[] = [];
    while (scan < changes.length && changes[scan]!.kind !== " ") {
      const item = changes[scan++]!;
      (item.kind === "-" ? old : next).push(item.line);
      budget.step();
      await budget.checkpoint();
    }
    for (let index = 0; index < Math.max(old.length, next.length); index++) {
      const left = old[index], right = next[index];
      row(left, right, left === undefined ? ">" : right === undefined ? "<" : !left.endsWith("\n") && right.endsWith("\n") ? "\\" : left.endsWith("\n") && !right.endsWith("\n") ? "/" : "|");
      budget.step(1 + (left?.length ?? 0) + (right?.length ?? 0));
      await budget.checkpoint();
    }
  }
}

export async function script(changes: readonly Edit[], format: "ed" | "rcs", budget: Budget, append: (text: string) => void): Promise<void> {
  const groups: { position: number; old: string[]; next: string[] }[] = [];
  let scan = 0, position = 0;
  while (scan < changes.length) {
    budget.step();
    await budget.checkpoint();
    if (changes[scan]!.kind === " ") { position++; scan++; continue; }
    const group = { position, old: [] as string[], next: [] as string[] };
    while (scan < changes.length && changes[scan]!.kind !== " ") {
      const edit = changes[scan++]!;
      (edit.kind === "-" ? group.old : group.next).push(edit.line);
      if (edit.kind === "-") position++;
      budget.step();
      await budget.checkpoint();
    }
    budget.hunk();
    if (!changes[scan - 1]!.ignored) groups.push(group);
  }
  if (format === "ed") groups.reverse();
  for (const group of groups) {
    if (format === "rcs") {
      if (group.old.length) append(`d${group.position + 1} ${group.old.length}\n`);
      if (group.next.length) append(`a${group.position + group.old.length} ${group.next.length}\n${group.next.join("")}`);
    } else {
      if (group.old.some(line => !line.endsWith("\n")) || group.next.some(line => !line.endsWith("\n"))) throw new ToolError("No newline at end of file");
      const start = group.position + 1, end = group.position + group.old.length;
      const range = group.old.length > 1 ? `${start},${end}` : `${start}`;
      append(`${group.old.length ? range : group.position}${group.old.length ? group.next.length ? "c" : "d" : "a"}\n`);
      if (group.next.length) {
        let inserted = 0;
        for (const line of group.next) {
          inserted++;
          if (line === ".\n") {
            append("..\n.\ns/.//\n");
            if (inserted < group.next.length) append("a\n");
          } else append(line);
          budget.step(1 + line.length);
          await budget.checkpoint();
        }
        if (group.next.at(-1) !== ".\n") append(".\n");
      }
    }
    budget.step();
    await budget.checkpoint();
  }
}

export async function ifdef(changes: readonly Edit[], symbol: string, budget: Budget, append: (text: string) => void): Promise<void> {
  let scan = 0;
  while (scan < changes.length) {
    budget.step();
    await budget.checkpoint();
    if (changes[scan]!.kind === " ") { append(changes[scan++]!.line); continue; }
    const old: string[] = [], next: string[] = [];
    while (scan < changes.length && changes[scan]!.kind !== " ") {
      const edit = changes[scan++]!;
      (edit.kind === "-" ? old : next).push(edit.line);
      budget.step();
      await budget.checkpoint();
    }
    budget.hunk();
    if (changes[scan - 1]!.ignored) { append(old.join("")); continue; }
    append(`#if${old.length ? "n" : ""}def ${symbol}\n`);
    if (old.length) append(old.join(""));
    if (old.length && next.length) append(`#else /* ${symbol} */\n`);
    if (next.length) append(next.join(""));
    append(`#endif /* ${old.length && !next.length ? "! " : ""}${symbol} */\n`);
  }
}
