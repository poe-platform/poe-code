import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const output = join(directory, "comparison.json");
assert.equal(existsSync(output), false, "comparison is append-only");
const original = JSON.parse(readFileSync(join(directory, "original-c800c899/report.json")));
const candidate = JSON.parse(readFileSync(join(directory, "candidate-5ba1a0f3/report.json")));
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const owned = ["tests/shell-stress/env-split-author/resume-host.ts", "tests/shell/errexit-host.test.ts", "tests/shell/expanded-gaps-env-host.test.ts"];
assert.equal(git("diff", "--name-only", original.revision, candidate.parent, "--", ...candidate.inputs).toString(), "");
assert.deepEqual(git("diff", "--name-only", candidate.parent, candidate.revision).toString().trim().split("\n").sort(), [...owned].sort());
const sourceDelta = Object.keys(candidate.sourceBefore).filter(path => original.sourceBefore[path] !== candidate.sourceBefore[path]);
assert.deepEqual(sourceDelta.sort(), [...owned].sort());
assert.deepEqual(original.observations, candidate.observations);
assert.deepEqual(original.literalInputs, candidate.literalInputs);
function descendants(node, predicate) {
  const found = [];
  const visit = current => { if (predicate(current)) found.push(current); ts.forEachChild(current, visit); };
  visit(node);
  return found;
}
function literal(node, header) {
  if (ts.isStringLiteral(node)) return node.text;
  assert.ok(ts.isTemplateExpression(node));
  return node.head.text + node.templateSpans.map(span => {
    assert.equal(span.expression.getText(), "header");
    return header + span.literal.text;
  }).join("");
}
function fixtureInputs(revision) {
  const rows = [];
  for (const path of owned) {
    const text = git("show", `${revision}:${path}`).toString();
    const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    assert.deepEqual(tree.parseDiagnostics, []);
    if (path === owned[0]) {
      const writes = descendants(tree, node => ts.isCallExpression(node) && node.expression.getText() === "fs.writeFile" && node.arguments[0]?.getText() === '"/work/script"');
      assert.equal(writes.length, 1);
      const write = writes[0];
      rows.push({ path, header: "#!/usr/bin/env bash -e", script: literal(write.arguments[1].arguments[0]), file: literal(write.arguments[0]), mode: write.arguments[2].getText(), exec: 'shell.exec("./script")' });
    } else {
      for (const loop of descendants(tree, ts.isForOfStatement)) {
        const array = ts.isAsExpression(loop.expression) ? loop.expression.expression : loop.expression;
        if (!ts.isArrayLiteralExpression(array)) continue;
        const headers = array.elements.map(element => ts.isArrayLiteralExpression(element) ? element.elements[0] : element).filter(ts.isStringLiteral).map(node => node.text).filter(header => header.startsWith("#!/usr/bin/env") || header.startsWith("/usr/bin/env"));
        if (!headers.length) continue;
        const writes = descendants(loop.statement, node => ts.isCallExpression(node) && node.expression.getText() === "fs.writeFile");
        assert.equal(writes.length, 1);
        const write = writes[0];
        const calls = descendants(loop.statement, node => ts.isCallExpression(node) && node.expression.getText() === "shell.exec");
        assert.ok(calls.length > 0);
        for (const call of calls) assert.equal(call.getText(), 'shell.exec("/script")');
        for (const header of headers) rows.push({ path, header, script: literal(write.arguments[1].arguments[0], header), file: literal(write.arguments[0]), mode: write.arguments[2].getText(), exec: calls[0].getText() });
      }
    }
  }
  assert.equal(rows.length, 8);
  return rows;
}
const beforeInputs = fixtureInputs(original.revision);
const afterInputs = fixtureInputs(candidate.revision);
assert.deepEqual(afterInputs, beforeInputs);
assert.deepEqual(afterInputs.map(row => row.script), candidate.literalInputs.map(row => row.script));
for (const row of afterInputs) {
  row.body = row.script.slice(row.script.indexOf("\n") + 1);
  assert.ok(["printf BAD\n", "printf forbidden", "printf forbidden > marker\n"].includes(row.body));
  row.scriptSha256 = digest(row.script);
  row.scriptBase64 = Buffer.from(row.script).toString("base64");
}
const prefix = "tests/shell-stress/env-shebang-integration-review/";
const historicalPaths = [
  "guarded-ea409a6b-20260827-review1/report.json", "guarded-ea409a6b-20260827-review1/native.json", "guarded-ea409a6b-20260827-review1/manifest.json",
  "guarded-ea409a6b-20260827-review1-controls/original-assertion-observations.json", "guarded-ea409a6b-20260827-review1-controls/report.json", "guarded-ea409a6b-20260827-review1-controls/author.tap", "guarded-ea409a6b-20260827-review1-controls/core.tap", "guarded-ea409a6b-20260827-review1-controls/scripts.tap", "guarded-ea409a6b-20260827-review1-controls/manifest.json",
  "expectation-f6a3fa75/README.md", "expectation-f6a3fa75/report.json", "expectation-f6a3fa75/input-delta.diff", "expectation-f6a3fa75/transcript.log", "expectation-f6a3fa75/review-runner.mjs.data", "expectation-f6a3fa75/SHA256SUMS",
].map(path => prefix + path).concat(["tests/shell-stress/env-shebang-author/guarded-completion/fourth-author.tap", "tests/shell-stress/env-shebang-author/guarded-completion/manifest.json"]);
const history = historicalPaths.map(path => {
  const expected = digest(git("show", `${original.revision}:${path}`));
  const actual = digest(readFileSync(join(root, path)));
  assert.equal(actual, expected);
  return { path, sha256: actual, matchesGitRevision: original.revision };
});
const summary = capture => ({ revision: capture.revision, archiveSha256: capture.archiveSha256, canonical: capture.commands.find(row => row.name === "canonical").tap, resume: { total: capture.commands.filter(row => row.name.startsWith("resume-")).length, failures: capture.commands.filter(row => row.name.startsWith("resume-") && row.status !== 0).map(row => row.name) }, controls: capture.commands.find(row => row.name === "shebang-controls").tap, build: capture.commands.find(row => row.name === "build").status, strict: capture.commands.find(row => row.name === "strict-owned").status });
const processes = [original, candidate].flatMap(capture => capture.commands.map(row => {
  for (const target of [row.pid, -row.pid]) assert.throws(() => process.kill(target, 0), error => error.code === "ESRCH");
  return { capture: capture.label, command: row.name, pid: row.pid, pidAbsent: true, groupAbsent: true };
}));
for (const capture of [original, candidate]) assert.equal(existsSync(capture.scratch), false);
const comparison = { date: new Date().toISOString(), candidate: candidate.revision, parent: candidate.parent, original: summary(original), migrated: summary(candidate), originalSelectedInputsEqualParent: true, onlyChangedSourceInputs: sourceDelta, observationsUnchanged: true, fixtureInputBytesEqual: true, fixtureInputs: afterInputs, history, processes, scratchAbsent: true, limits: "Author verification only; source execution and scoped build/typecheck. No independent acceptance, native recapture, Linux qualification, complete typecheck inventory, packed consumer, full gate, superiority or 72-hour completion." };
writeFileSync(output, JSON.stringify(comparison, null, 2) + "\n");
writeFileSync(join(directory, "fixture-delta.diff"), git("diff", candidate.parent, candidate.revision, "--", ...owned));
console.log(JSON.stringify({ candidate: comparison.candidate, literalInputs: afterInputs.length, authenticatedHistory: history.length, absentProcessGroups: processes.length, observationsUnchanged: true }));
