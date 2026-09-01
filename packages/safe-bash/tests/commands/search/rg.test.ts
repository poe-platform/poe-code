import assert from "node:assert/strict";
import test from "node:test";
import { jsonEvents, virtual, type Fixture } from "./helpers.js";

const files = { "alpha.txt": "first\nneedle needle\nthird\nneedle\nlast", "beta.txt": "none\n", "sub/code.ts": "const needle = 1;\n", "sub/code.js": "needle();\n" };
const cases: Record<string, Fixture> = {
  "stdin line numbers": { args: ["-n", "needle", "-"], stdin: "no\nneedle\nend" },
  "piped stdin inferred": { args: ["needle"], stdin: "needle\nother\n" },
  "single file omits filename": { args: ["needle", "alpha.txt"], files },
  "multiple files prefix names": { args: ["needle", "alpha.txt", "beta.txt"], files },
  "recursive sorted traversal": { args: ["-n", "needle", "."], files },
  "subdirectory preserves spelling": { args: ["needle", "./sub"], files },
  "combined flags": { args: ["-nHi", "NEEDLE", "alpha.txt"], files },
  "negative line selection": { args: ["-nv", "needle", "alpha.txt"], files },
  "whole lines": { args: ["-x", "needle", "alpha.txt"], files },
  "word boundaries Unicode": { args: ["-w", "cat", "-"], stdin: "cat\ncat1\nécat\ncat!\ncat_\n" },
  "fixed metacharacters": { args: ["-F", "a.b", "-"], stdin: "a.b\naXb\n" },
  "multiple patterns": { args: ["-e", "^first", "-e", "last$", "alpha.txt"], files },
  "attached pattern options": { args: ["-efirst", "-elast", "alpha.txt"], files },
  "pattern files": { args: ["-f", "patterns", "alpha.txt"], files: { ...files, patterns: "^first\nlast$\n" } },
  "patterns from stdin": { args: ["-f", "-", "alpha.txt"], stdin: "needle\n", files },
  "empty pattern file never matches": { args: ["-f", "patterns", "alpha.txt"], files: { ...files, patterns: "" }, code: 1 },
  "empty pattern file inverted": { args: ["-v", "-f", "patterns", "beta.txt"], files: { ...files, patterns: "" } },
  "empty pattern matches empty lines": { args: ["-n", "", "-"], stdin: "one\n\ntwo\n" },
  "smart case lowercase": { args: ["-S", "needle", "-"], stdin: "NEEDLE\nNeedle\nneedle\n" },
  "smart case uppercase": { args: ["-S", "Needle", "-"], stdin: "NEEDLE\nNeedle\nneedle\n" },
  "case flag last wins": { args: ["-is", "needle", "-"], stdin: "NEEDLE\nneedle\n" },
  "only matches and columns": { args: ["--column", "-o", "needle", "alpha.txt"], files },
  "byte offsets Unicode": { args: ["-bon", "cat", "-"], stdin: "é cat cat\n😀cat\n" },
  "inverted only matching prints selected lines": { args: ["-ov", "needle", "alpha.txt"], files },
  "matching filename list": { args: ["-l", "needle", "."], files },
  "nonmatching filename list": { args: ["--files-without-match", "needle", "."], files },
  "nonmatching files exit one if absent": { args: ["--files-without-match", "needle", "alpha.txt"], files, code: 1 },
  "count lines suppresses zero": { args: ["-c", "needle", "alpha.txt", "beta.txt"], files },
  "count occurrences": { args: ["--count-matches", "needle", "alpha.txt"], files },
  "count plus only matching counts occurrences": { args: ["-co", "needle", "alpha.txt"], files },
  "count include zero": { args: ["-c", "--include-zero", "needle", "beta.txt"], files, code: 1 },
  "count inverted": { args: ["-cv", "needle", "alpha.txt"], files },
  "count matches inverted counts selected lines": { args: ["--count-matches", "-v", "needle", "alpha.txt"], files },
  "quiet without-match uses file selection status": { args: ["-q", "--files-without-match", "needle", "alpha.txt"], files, code: 1 },
  "quiet match": { args: ["-q", "needle", "alpha.txt"], files },
  "quiet miss": { args: ["-q", "absent", "alpha.txt"], files, code: 1 },
  "max count": { args: ["-nm1", "needle", "alpha.txt"], files },
  "context adjacent groups merge": { args: ["-nC1", "needle", "alpha.txt"], files },
  "context disjoint separator": { args: ["-nB1", "needle", "-"], stdin: "a\nneedle\nc\nd\ne\nneedle\ng\n" },
  "after context with match limit": { args: ["-nA1", "-m1", "needle", "alpha.txt"], files },
  "custom separator": { args: ["-C0", "-B1", "--context-separator=NEXT", "needle", "-"], stdin: "one\nneedle\nblank\nblank\nneedle\n" },
  "null filename list": { args: ["-l0", "needle", "."], files },
  "null path prefix with line numbers": { args: ["-Hn0", "needle", "alpha.txt"], files },
  "null data records": { args: ["--null-data", "-n", "needle", "-"], stdin: "no\0needle\0last" },
  "CRLF mode": { args: ["--crlf", "-n", "needle$", "-"], stdin: "needle\r\nno\r\n" },
  "file listing ignores content": { args: ["--files", "."], files },
  "file list with glob brace expansion": { args: ["--files", "-g", "*.{ts,js}", "."], files },
  "glob positive plus negative": { args: ["-g", "*.{ts,js}", "-g", "!*.js", "needle", "."], files },
  "glob last wins": { args: ["--files", "-g", "!*.ts", "-g", "*.ts", "."], files },
  "glob insensitive": { args: ["--files", "--iglob=*.TS", "."], files },
  "glob stars across nested paths": { args: ["--files", "-g", "sub/**/*.ts", "."], files: { ...files, "sub/nested/deep.ts": "" } },
  "hidden default": { args: ["--files", "."], files: { ...files, ".secret": "needle", ".cache/cache": "needle" } },
  "hidden option": { args: ["--files", "--hidden", "."], files: { ...files, ".secret": "needle", ".cache/cache": "needle" } },
  "positive glob overrides hidden": { args: ["--files", "-g", "*.ts", "."], files: { ...files, ".hidden.ts": "needle" } },
  "positive glob overrides matching file ignore": { args: ["--files", "-g", "*.ts", "."], files: { ...files, "sub/.ignore": "code.ts\n" } },
  "gitignore repository detection": { args: ["--files", "."], directories: [".git"], files: { ...files, ".gitignore": "*.txt\n" } },
  "gitignore requires git by default": { args: ["--files", "."], files: { ...files, ".gitignore": "*.txt\n" } },
  "no require git": { args: ["--files", "--no-require-git", "."], files: { ...files, ".gitignore": "*.txt\n" } },
  "ignore negation": { args: ["--files", "."], files: { ...files, ".ignore": "*.txt\n!alpha.txt\n" } },
  "nested ignore negation": { args: ["--files", "."], files: { ...files, ".ignore": "*.ts\n", "sub/.ignore": "!code.ts\n" } },
  "ignored parent prevents child reinclude": { args: ["--files", "."], files: { ...files, ".ignore": "sub/\n!sub/code.ts\n" } },
  "explicit parent reinclude": { args: ["--files", "."], files: { ...files, ".ignore": "sub/\n!sub/\nsub/*.js\n" } },
  "ignore file precedence": { args: ["--files", "."], directories: [".git"], files: { ...files, ".gitignore": "*.txt\n", ".ignore": "!alpha.txt\n", ".rgignore": "alpha.txt\n!beta.txt\n" } },
  "ignore escaped hash bang and spaces": { args: ["--files", "."], files: { keep: "", "#hash": "", "!bang": "", "trailing ": "", ".ignore": "# comment\n\\#hash\n\\!bang\ntrailing\\ \n" } },
  "explicit path overrides ignore and glob": { args: ["-g", "!*.txt", "needle", "alpha.txt"], files: { ...files, ".ignore": "*.txt\n" } },
  "no ignore preserves hidden filtering": { args: ["--files", "-u", "."], files: { ...files, ".ignore": "*.txt\n", ".secret": "" } },
  "two unrestricted flags include hidden": { args: ["--files", "-uu", "."], files: { ...files, ".ignore": "*.txt\n", ".secret": "" } },
  "maximum directory depth": { args: ["--files", "--max-depth=1", "."], files },
  "symlinks skipped recursively": { args: ["--files", "."], files, links: { alias: "alpha.txt" } },
  "follow symlinks": { args: ["--files", "-L", "."], files, links: { alias: "alpha.txt" } },
  "explicit symlink follows without L": { args: ["needle", "alias"], files, links: { alias: "alpha.txt" } },
  "binary skipped recursively": { args: ["needle", "."], files: { text: "needle\n", binary: Buffer.from("needle\0rest\n") } },
  "binary explicit reports match": { args: ["needle", "binary"], files: { binary: Buffer.from("before\0needle\n") } },
  "binary mode recursive reports match": { args: ["--binary", "needle", "."], files: { binary: Buffer.from("needle\0rest\n") } },
  "binary forced text preserves bytes": { args: ["-an", "needle", "binary"], files: { binary: Buffer.from("needle\0rest\n") } },
  "binary count": { args: ["-c", "needle", "binary"], files: { binary: Buffer.from("needle\0rest\n") } },
  "Unicode fixed matching": { args: ["-Fno", "😀", "-"], stdin: "é😀😀\n" },
  "JSON match offsets and totals": { args: ["--json", "needle", "alpha.txt", "beta.txt"], files },
  "JSON context": { args: ["--json", "-C1", "needle", "alpha.txt"], files },
  "JSON no matches only summary": { args: ["--json", "absent", "alpha.txt"], files, code: 1 },
  "zero max-count suppresses even JSON summary": { args: ["--json", "-m0", "needle", "alpha.txt"], files, code: 1 },
  "JSON inverted selection": { args: ["--json", "-v", "needle", "alpha.txt"], files },
  "JSON binary record splitting": { args: ["--json", "needle", "binary"], files: { binary: Buffer.from("before\0needle\n") } },
  "JSON invalid UTF8 uses base64": { args: ["--json", "needle", "bad"], files: { bad: Buffer.from([255, 110, 101, 101, 100, 108, 101, 10]) } },
  "JSON Unicode byte submatches": { args: ["--json", "😀", "-"], stdin: "é😀😀\n" },
  "JSON overridden by filename mode": { args: ["--json", "-l", "needle", "alpha.txt"], files },
};

test("deterministic virtual results do not depend on native rg availability", async () => {
  const result = await virtual({ args: ["-n", "-g", "*.ts", "TODO", "."], files: { "src/a.ts": "x\n// TODO: implement\n", "src/b.js": "TODO\n", "src/.ignore": "*.js\n" } });
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), "./src/a.ts:2:// TODO: implement\n");
  assert.equal(result.stderr.length, 0);
});

test("JSON schema uses original invalid bytes and byte offsets", async () => {
  const result = await virtual({ args: ["--json", "cat", "-"], stdin: Buffer.from([255, 99, 97, 116, 10]) });
  const events = jsonEvents(result.stdout) as { type: string; data: Record<string, unknown> }[];
  assert.deepEqual(events.map(event => event.type), ["begin", "match", "end", "summary"]);
  assert.deepEqual(events[1]!.data.lines, { bytes: "/2NhdAo=" });
  assert.deepEqual(events[1]!.data.submatches, [{ match: { text: "cat" }, start: 1, end: 4 }]);
});
