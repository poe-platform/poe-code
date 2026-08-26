import type { Files } from "./helpers.js";

export interface PatchCase {
  name: string;
  files: Files;
  patch: string;
  args?: readonly string[];
  nativeArgs?: readonly string[];
  status?: number;
  expected: Readonly<Record<string, string | null>>;
}

const headers = "--- target\n+++ target\n";
export const cases: readonly PatchCase[] = [
  { name: "POSIX empty context line without prefix", files: { target: "head\n\nold\n" },
    patch: headers + "@@ -1,3 +1,3 @@\n head\n\n-old\n+new\n", expected: { target: "head\n\nnew\n" } },
  { name: "BSD EXTENSION zero-width range after first deletion", files: { target: "a\nb\n" },
    patch: headers + "@@ -1 +1,0 @@\n-a\n", expected: { target: "b\n" } },
  { name: "two hunks with insertion delta and later deletion", files: { target: "a\nb\nc\nd\ne\nf\ng\n" },
    patch: headers + "@@ -1,2 +1,3 @@\n a\n+inserted\n b\n@@ -5,3 +6,2 @@\n e\n-f\n g\n", expected: { target: "a\ninserted\nb\nc\nd\ne\ng\n" } },
  { name: "offset carried to context-free EOF insertion", files: { target: "prefix\na\nb\nc\n" },
    patch: headers + "@@ -1 +1 @@\n-a\n+A\n@@ -3,0 +4 @@\n+end\n", expected: { target: "prefix\nA\nb\nc\nend\n" } },
  { name: "negative offset with shrinking first hunk", files: { target: "a\nb\nc\nd\ne\n" },
    patch: headers + "@@ -2,2 +2 @@\n-a\n b\n@@ -5,2 +4,2 @@\n d\n-e\n+E\n", expected: { target: "b\nc\nd\nE\n" } },
  { name: "zero-context beginning and EOF insertions", files: { target: "middle\n" },
    patch: headers + "@@ -0,0 +1 @@\n+start\n@@ -1,0 +3 @@\n+end\n", expected: { target: "start\nmiddle\nend\n" } },
  { name: "whitespace-only line edits preserve tabs and spaces", files: { target: "\t \n\nlast\n" },
    patch: headers + "@@ -1,3 +1,3 @@\n-\t \n+ \t\n \n last\n", expected: { target: " \t\n\nlast\n" } },
  { name: "unchanged incomplete EOF context", files: { target: "old\nlast" },
    patch: headers + "@@ -1,2 +1,2 @@\n-old\n+new\n last\n\\ No newline at end of file\n", expected: { target: "new\nlast" } },
  { name: "delete only newline from final line", files: { target: "\n" },
    patch: headers + "@@ -1 +0,0 @@\n-\n", expected: { target: "" } },
  { name: "empty target gains blank line", files: { target: "" },
    patch: headers + "@@ -0,0 +1 @@\n+\n", expected: { target: "\n" } },
  { name: "reverse full deletion into existing empty file", files: { target: "" }, args: ["-R"],
    patch: headers + "@@ -1,2 +0,0 @@\n-one\n-two\n", expected: { target: "one\ntwo\n" } },
  { name: "ORACLE LIMITATION reverse zero-context interior deletion", files: { target: "a\nc\n" }, args: ["-R"],
    patch: headers + "@@ -2 +1,0 @@\n-b\n", expected: { target: "a\nb\nc\n" } },
  { name: "replace incomplete EOF with two full lines", files: { target: "head\nend" },
    patch: headers + "@@ -1,2 +1,3 @@\n head\n-end\n\\ No newline at end of file\n+END\n+tail\n", expected: { target: "head\nEND\ntail\n" } },
  { name: "content resembles file and hunk headers", files: { target: "--- old\n@@ metadata\n+++ old\n" },
    patch: headers + "@@ -1,3 +1,3 @@\n---- old\n+--- new\n @@ metadata\n-+++ old\n++++ new\n", expected: { target: "--- new\n@@ metadata\n+++ new\n" } },
  { name: "section heading after hunk coordinates", files: { target: "old\n" },
    patch: headers + "@@ -1 +1 @@ function update()\n-old\n+new\n", expected: { target: "new\n" } },
  { name: "two outer lines fuzz retain actual context", files: { target: "local1\nlocal2\nold\nlocal3\nlocal4\n" }, args: ["--fuzz=2"],
    patch: headers + "@@ -1,5 +1,5 @@\n upstream1\n upstream2\n-old\n+new\n upstream3\n upstream4\n", expected: { target: "local1\nlocal2\nnew\nlocal3\nlocal4\n" } },
  { name: "GNU asymmetric fuzz with no leading context", files: { target: "old\nactual\n" }, args: ["-F1"],
    patch: headers + "@@ -1,2 +1,2 @@\n-old\n+new\n expected\n", expected: { target: "new\nactual\n" } },
  { name: "explicit target overrides unrelated labels", files: { target: "old\n" }, args: ["target"],
    patch: "--- before-label\n+++ after-label\n@@ -1 +1 @@\n-old\n+new\n", expected: { target: "new\n" } },
  { name: "strip two components with timestamped paths", files: { "dir/target": "old\n" }, args: ["-p2"],
    patch: "--- a/project/dir/target\t2026-08-26 01:00:00 +0000\n+++ b/project/dir/target\t2026-08-26 02:00:00 +0000\n@@ -1 +1 @@\n-old\n+new\n", expected: { "dir/target": "new\n" } },
  { name: "reverse newline markers and grouped flags", files: { target: "new\n" }, args: ["-RuF0"],
    patch: headers + "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n", expected: { target: "old" } },
  { name: "creation and deletion plus changed file in one patch", files: { gone: "bye", target: "old\n" }, args: ["-p1"], nativeArgs: ["-E"],
    patch: "--- /dev/null\n+++ b/created\n@@ -0,0 +1 @@\n+hello\n\\ No newline at end of file\n--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n\\ No newline at end of file\n--- a/target\n+++ b/target\n@@ -1 +1 @@\n-old\n+new\n",
    expected: { created: "hello", gone: null, target: "new\n" } },
  { name: "dry-run multi-file leaves existence and bytes untouched", files: { target: "old\n" }, args: ["--dry-run"],
    patch: headers + "@@ -1 +1 @@\n-old\n+new\n--- /dev/null\n+++ created\n@@ -0,0 +1 @@\n+fresh\n", expected: { target: "old\n", created: null } },
  { name: "UTF-8 BOM and CRLF retained around local edit", files: { target: "\ufeffhead\r\nold\r\n尾" },
    patch: headers + "@@ -1,3 +1,3 @@\n \ufeffhead\r\n-old\r\n+new\r\n 尾\n\\ No newline at end of file\n", expected: { target: "\ufeffhead\r\nnew\r\n尾" } },
];
