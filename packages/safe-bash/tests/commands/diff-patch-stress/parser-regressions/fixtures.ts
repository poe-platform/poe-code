import type { DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";

export interface ParserCase {
  readonly id: string;
  readonly category: string;
  readonly before: string;
  readonly patch: string;
  readonly after?: string;
  readonly options?: DiffPatchOptions;
  readonly cancel?: "before" | "input" | "parse";
  readonly native?: boolean;
  readonly args?: readonly string[];
  readonly expectedConflict?: boolean;
}

export const marker = "\\ No newline at end of file\n";
export const normalChange = "1c1\n< old\n---\n> new\n";
export const contextHeader = "*** target\n--- target\n";
export const contextChange = `${contextHeader}***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n`;
const unifiedChange = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";
const context = (body: string) => `${contextHeader}***************\n${body}`;
const valid = (id: string, before: string, patch: string, after: string, category = "valid grammar"): ParserCase => ({ id, before, patch, after, category });
const invalid = (id: string, patch: string, category: string, before = "old\nkeep\nend\n"): ParserCase => ({ id, before, patch, category });

export const grammarCases: readonly ParserCase[] = [
  valid("normal-empty-insert", "", "0a1\n> new\n", "new\n"),
  valid("normal-empty-insert-incomplete", "", `0a1\n> new\n${marker}`, "new"),
  valid("normal-delete-to-empty", "old\n", "1d0\n< old\n", ""),
  valid("normal-both-incomplete", "old", `1c1\n< old\n${marker}---\n> new\n${marker}`, "new"),
  valid("normal-blank-data", "old\n", "1c1\n< old\n---\n> \n", "\n"),
  valid("normal-tab-prefix", "old\n", "1c1\n<\told\n---\n>\tnew\n", "new\n"),
  valid("normal-patch-looking-data", "old\n", "1c1,5\n< old\n---\n> *** target\n> --- 1 ----\n> @@ -1 +1 @@\n> \\ No newline at end of file\n> 1c1\n", "*** target\n--- 1 ----\n@@ -1 +1 @@\n\\ No newline at end of file\n1c1\n"),
  valid("normal-crlf-data", "old\r\n", "1c1\n< old\r\n---\n> new\r\n", "new\r\n"),
  valid("normal-suppress-blank-empty", "old\n", "1c1\n< old\n---\n>\n", "\n", "GNU suppress-blank-empty"),
  valid("normal-empty-patch-noop", "old\n", "", "old\n"),
  valid("normal-leading-empty-lines", "old\n", `\n\n${normalChange}`, "new\n"),
  valid("normal-two-ordered-hunks", "old\nkeep\nend\n", `${normalChange}3c3\n< end\n---\n> final\n`, "new\nkeep\nfinal\n"),
  valid("context-empty-insert", "", context("*** 0 ****\n--- 1 ----\n+ new\n"), "new\n"),
  valid("context-delete-to-empty", "old\n", context("*** 1 ****\n- old\n--- 0 ----\n"), ""),
  valid("context-empty-insert-incomplete", "", context(`*** 0 ****\n--- 1 ----\n+ new\n${marker}`), "new"),
  valid("context-both-incomplete", "old", context(`*** 1 ****\n! old\n${marker}--- 1 ----\n! new\n${marker}`), "new"),
  valid("context-omitted-old-with-context", "left\nright\n", context("*** 1,2 ****\n--- 1,3 ----\n  left\n+ added\n  right\n"), "left\nadded\nright\n"),
  valid("context-omitted-new-with-context", "left\nremoved\nright\n", context("*** 1,3 ****\n  left\n- removed\n  right\n--- 1,2 ----\n"), "left\nright\n"),
  valid("context-incomplete-shared-tail", "left\ntail", context(`*** 1,2 ****\n--- 1,3 ----\n  left\n+ added\n  tail\n${marker}`), "left\nadded\ntail"),
  valid("context-patch-looking-data", "old\n", context("*** 1 ****\n! old\n--- 1,4 ----\n! --- 1 ----\n! *** 1 ****\n! ***************\n! \\ No newline at end of file\n"), "--- 1 ----\n*** 1 ****\n***************\n\\ No newline at end of file\n"),
  valid("context-crlf-data", "old\r\n", context("*** 1 ****\n! old\r\n--- 1 ----\n! new\r\n"), "new\r\n"),
  valid("context-crlf-transport", "old\n", contextChange.replaceAll("\n", "\r\n"), "new\n", "GNU CRLF transport"),
  valid("context-suppress-blank-empty", "old\n", context("*** 1 ****\n! old\n--- 1 ----\n!\n"), "\n", "GNU suppress-blank-empty"),
  valid("context-blank-context-line", "\nold\n", context("*** 1,2 ****\n  \n! old\n--- 1,2 ----\n  \n! new\n"), "\nnew\n"),
  valid("mixed-normal-context", "old\n", normalChange + contextChange.replaceAll("old", "new").replace(/! new\n$/u, "! final\n"), "final\n", "mixed sections"),
  valid("mixed-context-unified", "old\n", contextChange + unifiedChange.replace("-old", "-new").replace("+new", "+final"), "final\n", "mixed sections"),
  valid("mixed-unified-normal", "old\n", unifiedChange + "1c1\n< new\n---\n> final\n", "final\n", "mixed sections"),
  valid("mixed-context-normal-unified", "old\n", contextChange + "1c1\n< new\n---\n> middle\n" + unifiedChange.replace("-old", "-middle").replace("+new", "+final"), "final\n", "mixed sections"),
  invalid("normal-truncated-new-body", "1c1\n< old\n---\n", "truncation"),
  invalid("normal-truncated-final-lf", normalChange.slice(0, -1), "truncation"),
  invalid("normal-missing-change-separator", "1c1\n< old\n> new\n", "malformed delimiter"),
  invalid("normal-old-count-underflow", "1,2c1\n< old\n---\n> new\n", "count mismatch"),
  { ...invalid("atomic-extension-normal-new-count-overflow", `${normalChange}> extra\n`, "count mismatch"), args: ["--atomic"] },
  invalid("normal-descending-range", "2,1c1\n< old\n---\n> new\n", "range/order"),
  invalid("normal-append-old-range", "0,1a1\n> new\n", "range/order"),
  invalid("normal-delete-new-range", "1d0,1\n< old\n", "range/order"),
  { ...invalid("atomic-extension-normal-overlapping-old-hunks", normalChange + normalChange, "GNU hunk conflict, not invalid syntax"), args: ["--atomic", "--batch", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject"], expectedConflict: true },
  valid("GNU-normal-new-coordinates-are-advisory", "old\nkeep\nend\n", "1c2\n< old\n---\n> new\n", "new\nkeep\nend\n", "GNU coordinate target"),
  invalid("normal-unsafe-integer", "9007199254740993a1\n> new\n", "coordinate overflow"),
  invalid("normal-marker-before-body", `1c1\n${marker}< old\n---\n> new\n`, "newline marker"),
  invalid("normal-incomplete-nonfinal-new-line", `1c1,2\n< old\n---\n> new\n${marker}> tail\n`, "newline marker"),
  invalid("context-missing-new-range", context("*** 1 ****\n! old\n! new\n"), "truncation"),
  invalid("context-old-count-mismatch", context("*** 1,2 ****\n! old\n--- 1 ----\n! new\n"), "count mismatch"),
  invalid("context-zero-nonempty-range", context("*** 0 ****\n! old\n--- 1 ----\n! new\n"), "range/order"),
  { ...invalid("atomic-extension-context-overlapping-hunks", contextChange + contextChange.slice(contextHeader.length), "GNU hunk conflict, not invalid syntax"), args: ["--atomic", "--batch", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject"], expectedConflict: true },
  invalid("context-unsafe-integer", context("*** 9007199254740993 ****\n! old\n--- 1 ----\n! new\n"), "coordinate overflow"),
  invalid("context-missing-changed-old-half", context("*** 1 ****\n--- 1 ----\n! new\n"), "omitted changed half"),
  invalid("context-missing-changed-new-half", context("*** 1 ****\n! old\n--- 1 ----\n"), "omitted changed half"),
  invalid("context-halves-disagree", context("*** 1,2 ****\n  old\n! keep\n--- 1,2 ----\n  wrong\n! new\n"), "context disagreement"),
  invalid("context-duplicate-newline-marker", context(`*** 1 ****\n! old\n--- 1 ----\n! new\n${marker}${marker}`), "newline marker"),
  { ...invalid("atomic-extension-normal-valid-then-malformed-context", normalChange + context("*** 1 ****\n! new\n--- 1 ----\n"), "late malformed section"), args: ["--atomic"] },
  { ...invalid("atomic-extension-context-valid-then-malformed-unified", contextChange + "--- other\n+++ other\n@@ -1 +1 @@\n-old\n", "late malformed section"), args: ["--atomic"] },
  { ...invalid("atomic-extension-normal-valid-then-truncated-normal", normalChange + "3c3\n< end\n---\n", "late malformed same-format hunk"), args: ["--atomic"] },
  { ...invalid("atomic-extension-context-valid-then-truncated-context", contextChange + context("*** 1 ****\n! new\n--- 1 ----\n"), "late malformed same-format section"), args: ["--atomic"] },
];

const mutationSeeds = [normalChange, contextChange] as const;
let mutationState = 0x73a5c91d;
export const mutationCases: readonly ParserCase[] = Array.from({ length: 8 }, (_, index) => {
  mutationState = (Math.imul(mutationState, 1664525) + 1013904223) >>> 0;
  const seed = mutationSeeds[index % mutationSeeds.length]!;
  const lines = seed.trimEnd().split("\n");
  const eligible = lines.map((line, position) => /^[<>!] /u.test(line) ? position : -1).filter(position => position >= 0);
  const position = eligible[mutationState % eligible.length]!;
  const mutation = index < 4 ? `?${String.fromCharCode(65 + (mutationState % 26))}` : "\u0000";
  lines[position] = mutation + lines[position]!.slice(1);
  return invalid(`mutation-${index}-${index % 2 ? "context" : "normal"}`, `${lines.join("\n")}\n`, "deterministic invalid-prefix mutation", "old\n");
});

export const budgetCases: readonly ParserCase[] = [normalChange, contextChange].flatMap((patch, index) => {
  const format = index ? "context" : "normal";
  const twoHunks = index ? patch + patch.slice(contextHeader.length).replaceAll("1 ", "3 ").replaceAll("old", "end") : `${patch}3c3\n< end\n---\n> new\n`;
  return [
    { id: `${format}-maxLines-empty-flood`, category: "maxLines", before: "old\n", patch: `\n${"\n".repeat(128)}${patch}`, options: { maxLines: 64 }, native: false },
    { id: `${format}-maxHunks-second-hunk`, category: "maxHunks", before: "old\nkeep\nend\n", patch: twoHunks, options: { maxHunks: 1 }, native: false },
    { id: `${format}-maxWork-empty-flood`, category: "maxWork", before: "old\n", patch: `${"\n".repeat(128)}${patch}`, options: { maxWork: 16 }, native: false },
    { id: `${format}-maxInput`, category: "maxInputBytes", before: "old\n", patch, options: { maxInputBytes: Buffer.byteLength(patch) - 1 }, native: false },
    { id: `${format}-maxOutput`, category: "maxOutputBytes", before: "old\n", patch, options: { maxOutputBytes: 1 }, native: false },
    { id: `${format}-cancel-input`, category: "cancellation", before: "old\n", patch, cancel: "input", native: false },
    { id: `${format}-cancel-parse`, category: "cancellation", before: "old\n", patch: `${"\n".repeat(9000)}${patch}`, cancel: "parse", native: false },
  ] satisfies ParserCase[];
});

export const cases: readonly ParserCase[] = [...grammarCases, ...mutationCases, ...budgetCases];
