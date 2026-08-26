import type { Budget } from "./shared.js";

export interface Edit { readonly kind: " " | "+" | "-"; readonly line: string }

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
