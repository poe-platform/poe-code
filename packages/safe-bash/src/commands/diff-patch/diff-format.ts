import type { Budget } from "./shared.js";
import { colorText, expandTabs, type DisplayOptions } from "./diff-output.js";

export interface Edit { readonly kind: " " | "+" | "-"; readonly line: string; readonly newLine?: string; readonly ignored?: boolean }

function range(start: number, count: number): string {
  return count === 0 ? `${start}` : count === 1 ? `${start + 1}` : `${start + 1},${start + count}`;
}

function outputLine(prefix: string, line: string, options?: DisplayOptions, color?: 31 | 32): string {
  if (options?.initialTab) prefix = (prefix.length === 2 ? prefix.slice(0, -1) : prefix.trimEnd()) + "\t";
  if (options?.expand) line = expandTabs(line);
  const text = `${prefix}${line.endsWith("\n") ? line : line + "\n"}`;
  return (color === undefined ? text : colorText(text, color, options))
    + (line.endsWith("\n") ? "" : "\\ No newline at end of file\n");
}

export async function normal(changes: readonly Edit[], budget: Budget, append: (text: string) => void, options?: DisplayOptions): Promise<void> {
  let scan = 0;
  let oldPosition = 0;
  let newPosition = 0;
  while (scan < changes.length) {
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
    if (changes[scan]!.kind === " ") {
      oldPosition++;
      newPosition++;
      scan++;
      continue;
    }
    const start = scan;
    let oldCount = 0;
    let newCount = 0;
    while (scan < changes.length && changes[scan]!.kind !== " ") {
      if (changes[scan++]!.kind === "-") oldCount++;
      else newCount++;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    budget.hunk();
    if (changes[start]!.ignored) { oldPosition += oldCount; newPosition += newCount; continue; }
    append(colorText(`${range(oldPosition, oldCount)}${oldCount === 0 ? "a" : newCount === 0 ? "d" : "c"}${range(newPosition, newCount)}\n`, 36, options));
    for (const kind of ["-", "+"] as const) {
      if (kind === "+" && oldCount && newCount) append("---\n");
      for (let index = start; index < scan; index++) {
        const edit = changes[index]!;
        if (edit.kind === kind) append(outputLine(kind === "-" ? "< " : "> ", edit.line, options, kind === "-" ? 31 : 32));
        budget.step();
        { const c = budget.checkpoint(); if (c) await c; }
      }
    }
    oldPosition += oldCount;
    newPosition += newCount;
  }
}

function unifiedRange(start: number, count: number): string {
  return count === 0 ? `${start},0` : count === 1 ? `${start + 1}` : `${start + 1},${count}`;
}

async function contextSide(changes: readonly Edit[], start: number, end: number, kind: "+" | "-", budget: Budget, append: (text: string) => void, options?: DisplayOptions): Promise<void> {
  let scan = start;
  while (scan < end) {
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
    if (changes[scan]!.kind === " ") {
      const edit = changes[scan++]!;
      append(outputLine("  ", kind === "+" ? edit.newLine ?? edit.line : edit.line, options, kind === "-" ? 31 : 32));
      continue;
    }
    let groupEnd = scan;
    let removed = false;
    let added = false;
    while (groupEnd < end && changes[groupEnd]!.kind !== " ") {
      if (changes[groupEnd++]!.kind === "-") removed = true;
      else added = true;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    while (scan < groupEnd) {
      const edit = changes[scan++]!;
      if (edit.kind === kind) append(outputLine(removed && added ? "! " : `${kind} `, edit.line, options, kind === "-" ? 31 : 32));
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
  }
}

export async function contextual(changes: readonly Edit[], format: "unified" | "context", oldLabel: string, newLabel: string, context: number, budget: Budget, append: (text: string) => void, options?: DisplayOptions, heading?: (position: number) => Promise<string>): Promise<void> {
  context = Math.min(context, changes.length);
  append(colorText(`${format === "unified" ? "---" : "***"} ${oldLabel}\n`, 1, options));
  append(colorText(`${format === "unified" ? "+++" : "---"} ${newLabel}\n`, 1, options));
  let scan = 0;
  let oldPosition = 0;
  let newPosition = 0;
  while (scan < changes.length) {
    let changed = scan;
    while (changed < changes.length && changes[changed]!.kind === " ") {
      changed++;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    if (changed === changes.length) break;
    const start = Math.max(0, changed - context);
    let lastChange = changed;
    let end = changed + 1;
    while (end < changes.length && end - lastChange - 1 <= 2 * context) {
      if (changes[end]!.kind !== " ") {
        // Ignored blocks can extend existing context, but cannot pull a later
        // hunk into it from outside the trailing context window.
        if (changes[end]!.ignored && end - lastChange - 1 >= context) break;
        lastChange = end;
      }
      end++;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    end = Math.min(changes.length, lastChange + context + 1);
    // Splitting at an ignored block can leave shared context in both hunks.
    while (scan > start) {
      const edit = changes[--scan]!;
      if (edit.kind !== "+") oldPosition--;
      if (edit.kind !== "-") newPosition--;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    while (scan < start) {
      if (changes[scan]!.kind !== "+") oldPosition++;
      if (changes[scan++]!.kind !== "-") newPosition++;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    let oldCount = 0;
    let newCount = 0;
    let removed = false;
    let added = false;
    for (let index = start; index < end; index++) {
      const kind = changes[index]!.kind;
      if (kind !== "+") oldCount++;
      if (kind !== "-") newCount++;
      if (kind === "-") removed = true;
      if (kind === "+") added = true;
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
    }
    if (!changes.slice(start, end).some(edit => edit.kind !== " " && !edit.ignored)) {
      oldPosition += oldCount;
      newPosition += newCount;
      scan = end;
      continue;
    }
    budget.hunk();
    const functionLine = heading ? await heading(oldPosition) : "";
    if (format === "unified") {
      append(colorText(`@@ -${unifiedRange(oldPosition, oldCount)} +${unifiedRange(newPosition, newCount)} @@`, 36, options) + `${functionLine ? ` ${functionLine}` : ""}\n`);
      for (let index = start; index < end; index++) {
        const edit = changes[index]!;
        append(outputLine(edit.kind, edit.line, options, edit.kind === " " ? undefined : edit.kind === "-" ? 31 : 32));
        budget.step();
        { const c = budget.checkpoint(); if (c) await c; }
      }
    } else {
      append(`***************${functionLine ? ` ${functionLine}` : ""}\n` + colorText(`*** ${range(oldPosition, oldCount)} ****\n`, 36, options));
      if (removed) await contextSide(changes, start, end, "-", budget, append, options);
      append(colorText(`--- ${range(newPosition, newCount)} ----\n`, 36, options));
      if (added) await contextSide(changes, start, end, "+", budget, append, options);
    }
    scan = end;
    oldPosition += oldCount;
    newPosition += newCount;
  }
}
