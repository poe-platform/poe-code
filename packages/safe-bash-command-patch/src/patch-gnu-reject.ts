import { patchLine, type ReplayPatch, type ReplayOutcome } from "./stored-patch.js";
import type { Budget } from "safe-bash-diff-engine/shared";
import type { ByteSource } from "safe-bash-contracts";
import { targetBytes, type TargetLine } from "./stored-target.js";

function timestamp(header: string | undefined): string {
  if (!header) return "";
  const separator = header.indexOf("\t");
  return separator < 0 ? "" : header.slice(separator);
}

function unifiedRange(start: number, count: number, offset: number): string {
  return `${start + offset}${count === 1 ? "" : `,${count}`}`;
}

function contextRange(start: number, count: number, offset: number): string {
  return count === 0 ? "0" : count === 1 ? `${start + offset}` : `${start + offset},${start + offset + count - 1}`;
}

export async function* rejectBytes(patch: ReplayPatch, outcomes: Iterable<ReplayOutcome> | AsyncIterable<ReplayOutcome>, oldName: string | undefined,
  newName: string | undefined, indexName: string | undefined, reverse: boolean, budget: Budget, format?: "unified" | "context"): ByteSource {
  const normal = patch.format === "normal";
  const context = format === undefined ? patch.format === "context" || normal : format === "context";
  const names = [normal ? "/dev/null" : oldName ?? "/dev/null", normal ? "/dev/null" : newName ?? "/dev/null"];
  const times = normal ? ["", ""] : [timestamp(patch.oldHeader), timestamp(patch.newHeader)];
  if (reverse) { names.reverse(); times.reverse(); }
  const add = async function* (text: TargetLine): ByteSource {
    for await (const bytes of targetBytes(text)) { budget.outputLength(bytes.length); yield bytes; }
  };
  if (indexName !== undefined) yield* add(`Index: ${indexName}\n`);
  yield* add(`${context ? "***" : "---"} ${names[0]}${times[0]}\n${context ? "---" : "+++"} ${names[1]}${times[1]}\n`);
  for await (const outcome of outcomes) {
    if (!outcome.failed) continue;
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
    const { hunk, outputOffset } = outcome;
    if (!context) {
      yield* add(`@@ -${unifiedRange(hunk.oldStart, hunk.oldCount, outputOffset)} +${unifiedRange(hunk.newStart, hunk.newCount, outputOffset)} @@${hunk.section ?? ""}\n`);
      for (let start = 0; start < hunk.lines.length;) {
        budget.step();
        { const c = budget.checkpoint(); if (c) await c; }
        const line = (await patchLine(hunk, start));
        if (line.kind === " ") { yield* add(" "); yield* add(line.text); start++; continue; }
        let end = start;
        while (end < hunk.lines.length && (await patchLine(hunk, end)).kind !== " ") {
          end++; budget.step(); const c = budget.checkpoint(); if (c) await c;
        }
        for (const kind of ["-", "+"]) for (let index = start; index < end; index++) {
          const line = (await patchLine(hunk, index));
          if (line.kind === kind) { yield* add(kind); yield* add(line.text); }
        }
        start = end;
      }
    } else {
      yield* add(`***************${hunk.section ?? ""}\n*** ${contextRange(hunk.oldStart, hunk.oldCount, outputOffset)}${normal ? "" : " ****"}\n`);
      for (const kind of ["-", "+"] as const) {
        if (kind === "+") yield* add(`--- ${contextRange(hunk.newStart, hunk.newCount, outputOffset)}${normal ? " -----" : " ----"}\n`);
        for (let start = 0; start < hunk.lines.length;) {
          budget.step(); const c = budget.checkpoint(); if (c) await c;
          const line = (await patchLine(hunk, start));
          if (line.kind === " ") { yield* add("  "); yield* add(line.text); start++; continue; }
          let end = start, removed = false, added = false;
          while (end < hunk.lines.length && (await patchLine(hunk, end)).kind !== " ") {
            removed ||= (await patchLine(hunk, end)).kind === "-"; added ||= (await patchLine(hunk, end)).kind === "+";
            end++; budget.step(); const c = budget.checkpoint(); if (c) await c;
          }
          for (let index = start; index < end; index++) if ((await patchLine(hunk, index)).kind === kind) {
            yield* add(`${!normal && removed && added ? "!" : kind} `);
            yield* add((await patchLine(hunk, index)).text);
          }
          start = end;
        }
      }
    }
  }
}
