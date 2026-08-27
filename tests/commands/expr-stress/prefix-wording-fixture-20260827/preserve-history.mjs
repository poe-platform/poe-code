import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(evidence, "../../../..");
const output = path.join(evidence, "historical");
fs.mkdirSync(output);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const authorCommit = "d2115bc6be84bf2102cd64ffd1cf23db61ff83b3";
const authorBase = "tests/commands/expr-stress/inactive-prefix-author-20260827";
const reviewBase = "tests/commands/expr-stress/qualified-final-review-20260827";
const entries = [];
for (const [name, origin, commit] of [
  ["isolated-author-REPORT.md.data", `${authorBase}/REPORT.md`, authorCommit],
  ["isolated-author-binding.json", `${authorBase}/candidate-01/binding.json`, authorCommit],
  ["isolated-author-summary.json", `${authorBase}/candidate-01/summary.json`, authorCommit],
  ["isolated-author-regressions.json", `${authorBase}/candidate-01/regressions.json`, authorCommit],
  ["independent-original-221-of-225.json", `${reviewBase}/source-author-additional.json`, null],
  ["independent-original-provenance.json", `${reviewBase}/provenance.json`, null],
  ["independent-original-issue.txt", "/tmp/expr-qualified-final-review-20260827-issue.txt", null],
]) {
  const bytes = commit
    ? execFileSync("git", ["show", `${commit}:${origin}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    : fs.readFileSync(path.resolve(root, origin));
  fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
  if (!commit) assert.deepEqual(fs.readFileSync(path.resolve(root, origin)), bytes);
  entries.push({ path: name, origin, commit, sha256: hash(bytes), size: bytes.length, classification: commit ? "immutable historical author evidence, not this candidate" : "read-only snapshot of completed independent capture; not a rerun, rescore, or edit of reviewer artifacts" });
}
const independent = JSON.parse(fs.readFileSync(path.join(output, "independent-original-221-of-225.json")));
assert.equal(independent.status, 1);
for (const summary of ["ℹ tests 225", "ℹ pass 221", "ℹ fail 4"]) assert(independent.stdout.includes(summary));
const author = JSON.parse(fs.readFileSync(path.join(output, "isolated-author-summary.json")));
assert(author.regressionCounts.includes("# tests 217"));
assert(author.regressionCounts.includes("# pass 217"));
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ capturedAt: new Date().toISOString(), immutableAuthorEvidenceCommit: authorCommit, independentOriginal: { passed: 221, total: 225, failed: 4, sourceCommit: "4f01c1593486c1abff3b007f9a3b16923b88559f", remainsRed: true }, oldIsolatedAuthor: { passed: 217, total: 217, acceptedSource: "21220b465537bf45ffcfb36740956a69f43bf75e", overlays: ["src/commands/expr/evaluate.ts", "tests/commands/expr/inactive-prefix.test.ts"], notCombined4fQualification: true }, entries }, null, 2) + "\n", { flag: "wx" });
