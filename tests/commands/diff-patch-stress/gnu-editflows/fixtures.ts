export type Format = "unified" | "context" | "normal";
export interface Step { readonly args: readonly string[]; readonly input: string }
export interface Fixture {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: readonly string[];
  readonly steps: readonly Step[];
}

export function change(format: Format, path = "target", before = "old", after = "new", line = 1): string {
  if (format === "normal") return `diff ${path} ${path}\n${line}c${line}\n< ${before}\n---\n> ${after}\n`;
  if (format === "context") return `*** ${path}\n--- ${path}\n***************\n*** ${line} ****\n! ${before}\n--- ${line} ----\n! ${after}\n`;
  return `--- ${path}\n+++ ${path}\n@@ -${line} +${line} @@\n-${before}\n+${after}\n`;
}

export function twoHunks(format: Format): string {
  const first = change(format);
  const second = change(format, "target", "tail", "TAIL", 5);
  return first + second.split("\n").slice(format === "normal" ? 1 : 2).join("\n");
}

export function create(path: string, epoch = false): string {
  return `--- ${epoch ? `${path}\t1970-01-01 00:00:00 +0000` : "/dev/null"}\n+++ ${path}\t2026-08-26 00:00:00 +0000\n@@ -0,0 +1 @@\n+old\n`;
}

export function remove(path: string, epoch = false): string {
  return `--- ${path}\t2026-08-26 00:00:00 +0000\n+++ ${epoch ? `${path}\t1970-01-01 00:00:00 +0000` : "/dev/null"}\n@@ -1 +0,0 @@\n-old\n`;
}

const cases: Fixture[] = [];
function add(name: string, files: Fixture["files"], input: string, args: readonly string[] = [], directories?: readonly string[]): void {
  cases.push({ name, files, steps: [{ args, input }], ...(directories ? { directories } : {}) });
}

for (const format of ["unified", "context", "normal"] as const) {
  const args = format === "normal" ? ["target"] : [];
  add(`${format}/first-hunk-success-later-reject`, { target: "old\nkeep-a\nkeep-b\nkeep-c\nwrong\n" }, twoHunks(format), args);
  add(`${format}/first-hunk-reject-later-success`, { target: "wrong\nkeep-a\nkeep-b\nkeep-c\ntail\n" }, twoHunks(format), args);
  add(`${format}/two-rejects-existing-reject-replacement`, { target: "wrong\nkeep-a\nkeep-b\nkeep-c\nwrong\n", "target.rej": "stale reject\n" }, twoHunks(format), args);
  add(`${format}/dry-run-partial`, { target: "old\nkeep-a\nkeep-b\nkeep-c\nwrong\n", "target.rej": "preserve reject\n" }, twoHunks(format), ["--dry-run", ...args]);
  add(`${format}/explicit-absolute-target-strip-ignored`, { target: "old\n" }, change(format, "@ROOT@/work/header-only"), ["-p9", "@ROOT@/work/target"]);
  const multiple = change(format, "first") + change(format, "second") + change(format, "third");
  add(`${format}/later-file-reject-continue-third`, { first: "old\n", second: "wrong\n", third: "old\n" }, format === "normal" ? multiple.replaceAll(/diff ([a-z]+) [a-z]+\n/gu, "Index: $1\n") : multiple, format === "normal" ? ["-n"] : []);
}

add("unified/old-name-only-exists", { oldname: "old\n" }, change("unified", "oldname").replace("+++ oldname", "+++ newname"));
add("unified/new-name-only-exists", { newname: "old\n" }, change("unified", "oldname").replace("+++ oldname", "+++ newname"));
add("unified/both-names-shorter-component-count", { "deep/oldname": "old\n", newname: "old\n" }, change("unified", "deep/oldname").replace("+++ deep/oldname", "+++ newname"), ["-p0"]);
add("unified/both-names-shorter-basename", { longername: "old\n", new: "old\n" }, change("unified", "longername").replace("+++ longername", "+++ new"));
add("unified/default-strip-basename", { target: "old\n", "deep/target": "old\n" }, change("unified", "deep/target"));
add("unified/explicit-p0-retains-directory", { target: "old\n", "deep/target": "old\n" }, change("unified", "deep/target"), ["-p0"]);
add("unified/strip-one", { target: "old\n" }, change("unified", "old/target").replace("+++ old/target", "+++ new/target"), ["-p1"]);
add("unified/explicit-relative-overrides-headers", { chosen: "old\n", target: "untouched\n" }, change("unified"), ["chosen"]);
add("unified/later-missing-file-continue-third", { first: "old\n", third: "old\n" }, change("unified", "first") + change("unified", "missing") + change("unified", "third"));

add("sequential/same-target-success", { target: "old\n" }, change("unified", "target", "old", "middle") + change("unified", "target", "middle", "new"));
add("sequential/normalized-target-success", { target: "old\n" }, change("unified", "target", "old", "middle") + change("unified", "./target", "middle", "new"));
add("sequential/same-target-later-reject", { target: "old\n" }, change("unified") + change("unified", "target", "missing", "last"));
add("sequential/same-target-rejects-append-invocation", { target: "wrong\n", "target.rej": "stale\n" }, change("unified") + change("unified", "target", "another", "last"));
cases.push({ name: "sequential/reject-replacement-next-invocation", files: { target: "wrong\n", "target.rej": "stale\n" }, steps: [
  { args: [], input: change("unified") }, { args: [], input: change("unified", "target", "another", "last") },
] });
add("sequential/create-edit-delete", {}, create("target") + change("unified") + remove("target").replace("-old", "-new"));

add("null/create-nested-parents", {}, create("tree/deep/target"), ["-p0"]);
add("null/delete-prunes-to-cwd", { "tree/deep/target": "old\n" }, remove("tree/deep/target"), ["-p0"]);
add("null/delete-stops-at-nonempty-parent", { "tree/deep/target": "old\n", "tree/sibling": "keep\n" }, remove("tree/deep/target"), ["-p0"]);
add("null/delete-preserves-unrelated-empty-directory", { "tree/deep/target": "old\n" }, remove("tree/deep/target"), ["-p0"], ["unrelated/empty"]);
add("null/reverse-create-deletes-and-prunes", { "tree/deep/target": "old\n" }, create("tree/deep/target"), ["-R", "-p0"]);
add("null/reverse-delete-creates-parents", {}, remove("tree/deep/target"), ["-R", "-p0"]);
add("null/dry-run-create-no-parents", {}, create("tree/deep/target"), ["--dry-run", "-p0"]);
add("null/dry-run-delete-no-pruning", { "tree/deep/target": "old\n" }, remove("tree/deep/target"), ["--dry-run", "-p0"]);
add("epoch/create", {}, create("target", true));
add("epoch/delete", { target: "old\n" }, remove("target", true));
add("epoch/reverse-create", { target: "old\n" }, create("target", true), ["-R"]);
add("epoch/reverse-delete", {}, remove("target", true), ["-R"]);
add("empty/default-retains-empty-file", { "tree/target": "old\n" }, "--- tree/target\n+++ tree/target\n@@ -1 +0,0 @@\n-old\n", ["-p0"]);
add("empty/E-removes-and-prunes", { "tree/target": "old\n" }, "--- tree/target\n+++ tree/target\n@@ -1 +0,0 @@\n-old\n", ["-E", "-p0"]);
add("empty/E-dry-run-retains-file", { "tree/target": "old\n" }, "--- tree/target\n+++ tree/target\n@@ -1 +0,0 @@\n-old\n", ["-E", "--dry-run", "-p0"]);

export const fixtures: readonly Fixture[] = cases;
