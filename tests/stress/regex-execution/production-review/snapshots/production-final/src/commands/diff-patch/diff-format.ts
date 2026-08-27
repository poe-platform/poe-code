import type { Budget } from "./shared.js";

export interface Edit { readonly kind: " " | "+" | "-"; readonly line: string; readonly newLine?: string }

function range(start: number, count: number): string {
  return count === 0 ? `${start}` : count === 1 ? `${start + 1}` : `${start + 1},${start + count}`;
}

function outputLine(prefix: string, line: string): string {
  return `${prefix}${line}${line.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`;
}

export async function normal(changes: readonly Edit[], budget: Budget, append: (text: string) => void): Promise<void> {
  let scan = 0;
  let oldPosition = 0;
  let newPosition = 0;
  while (scan < changes.length) {
    budget.step();
    await budget.checkpoint();
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
      await budget.checkpoint();
    }
    budget.hunk();
    append(`${range(oldPosition, oldCount)}${oldCount === 0 ? "a" : newCount === 0 ? "d" : "c"}${range(newPosition, newCount)}\n`);
    for (const kind of ["-", "+"] as const) {
      if (kind === "+" && oldCount && newCount) append("---\n");
      for (let index = start; index < scan; index++) {
        const edit = changes[index]!;
        if (edit.kind === kind) append(outputLine(kind === "-" ? "< " : "> ", edit.line));
        budget.step();
        await budget.checkpoint();
      }
    }
    oldPosition += oldCount;
    newPosition += newCount;
  }
}

function unifiedRange(start: number, count: number): string {
  return count === 0 ? `${start},0` : count === 1 ? `${start + 1}` : `${start + 1},${count}`;
}

async function contextSide(changes: readonly Edit[], start: number, end: number, kind: "+" | "-", budget: Budget, append: (text: string) => void): Promise<void> {
  let scan = start;
  while (scan < end) {
    budget.step();
    await budget.checkpoint();
    if (changes[scan]!.kind === " ") {
      const edit = changes[scan++]!;
      append(outputLine("  ", kind === "+" ? edit.newLine ?? edit.line : edit.line));
      continue;
    }
    let groupEnd = scan;
    let removed = false;
    let added = false;
    while (groupEnd < end && changes[groupEnd]!.kind !== " ") {
      if (changes[groupEnd++]!.kind === "-") removed = true;
      else added = true;
      budget.step();
      await budget.checkpoint();
    }
    while (scan < groupEnd) {
      const edit = changes[scan++]!;
      if (edit.kind === kind) append(outputLine(removed && added ? "! " : `${kind} `, edit.line));
      budget.step();
      await budget.checkpoint();
    }
  }
}

export async function contextual(changes: readonly Edit[], format: "unified" | "context", oldLabel: string, newLabel: string, context: number, budget: Budget, append: (text: string) => void): Promise<void> {
  context = Math.min(context, changes.length);
  append(format === "unified" ? `--- ${oldLabel}\n+++ ${newLabel}\n` : `*** ${oldLabel}\n--- ${newLabel}\n`);
  let scan = 0;
  let oldPosition = 0;
  let newPosition = 0;
  while (scan < changes.length) {
    let changed = scan;
    while (changed < changes.length && changes[changed]!.kind === " ") {
      changed++;
      budget.step();
      await budget.checkpoint();
    }
    if (changed === changes.length) break;
    const start = Math.max(scan, changed - context);
    let lastChange = changed;
    let end = changed + 1;
    while (end < changes.length && end - lastChange - 1 <= 2 * context) {
      if (changes[end]!.kind !== " ") lastChange = end;
      end++;
      budget.step();
      await budget.checkpoint();
    }
    end = Math.min(changes.length, lastChange + context + 1);
    while (scan < start) {
      if (changes[scan]!.kind !== "+") oldPosition++;
      if (changes[scan++]!.kind !== "-") newPosition++;
      budget.step();
      await budget.checkpoint();
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
      await budget.checkpoint();
    }
    budget.hunk();
    if (format === "unified") {
      append(`@@ -${unifiedRange(oldPosition, oldCount)} +${unifiedRange(newPosition, newCount)} @@\n`);
      for (let index = start; index < end; index++) {
        const edit = changes[index]!;
        append(outputLine(edit.kind, edit.line));
        budget.step();
        await budget.checkpoint();
      }
    } else {
      append(`***************\n*** ${range(oldPosition, oldCount)} ****\n`);
      if (removed) await contextSide(changes, start, end, "-", budget, append);
      append(`--- ${range(newPosition, newCount)} ----\n`);
      if (added) await contextSide(changes, start, end, "+", budget, append);
    }
    scan = end;
    oldPosition += oldCount;
    newPosition += newCount;
  }
}
