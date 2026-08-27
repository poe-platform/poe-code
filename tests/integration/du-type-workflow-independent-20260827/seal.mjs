import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = join(owned, "../../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const parse = path => JSON.parse(readFileSync(join(owned, path)));
const git = args => execFileSync("/usr/bin/git", args, { cwd: repository, maxBuffer: 96 * 1024 * 1024 });
const record = (path, bytes) => ({ path, bytes: bytes.length, sha256: digest(bytes) });
const records = [];
const walk = prefix => {
  for (const name of readdirSync(join(owned, prefix)).sort()) {
    if (!prefix && (name.startsWith(".work-") || name === "MANIFEST.json")) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    const info = lstatSync(join(owned, path)); assert.ok(!info.isSymbolicLink(), path);
    if (info.isDirectory()) walk(path); else { assert.ok(info.isFile(), path); records.push(record(path, readFileSync(join(owned, path)))); }
  }
};
walk("");
const auth = parse("receipts/authentication.json");
const author = parse("receipts/author-binding.json");
const execution = parse("receipts/execution.json");
const followup = parse("receipts/followup/result.json");
const followupBefore = parse("receipts/followup/before.json");
const followupAfter = parse("receipts/followup/after.json");
for (const tool of auth.tools) assert.equal(digest(readFileSync(tool.path)), tool.sha256);
for (const supervisor of [...auth.supervisors, ...followupBefore.supervisors]) assert.equal(digest(readFileSync(join(owned, supervisor.path))), supervisor.sha256);
for (const identity of auth.identities) {
  assert.equal(git(["rev-parse", `${identity.commit}^{tree}`]).toString().trim(), identity.tree);
  assert.equal(git(["diff-tree", "--no-commit-id", "--name-status", "-r", identity.commit]).toString().trim(), identity.delta);
  for (const parent of identity.parents) git(["merge-base", "--is-ancestor", parent, identity.commit]);
}
for (let index = 1; index < auth.identities.length; index++) git(["merge-base", "--is-ancestor", auth.identities[index - 1].commit, auth.identities[index].commit]);
const candidate = execution.candidate;
const tree = git(["ls-tree", "-r", "--name-only", candidate]).toString().trim().split("\n");
const authorSet = tree.filter(path => path.startsWith("src/") || path.startsWith("scripts/") || path.startsWith("tests/plugins/qualified-current-release") || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(path));
assert.deepEqual(author.sourceInputs.map(entry => entry.path).sort(), authorSet.sort());
assert.equal(authorSet.length, 314);
assert.deepEqual(tree.filter(path => path.endsWith(".mts")).sort(), [...auth.completeTrackedMts].sort());
for (const entry of [...auth.selectedInputs, ...author.sourceInputs]) {
  const bytes = git(["show", `${candidate}:${entry.path}`]); assert.equal(digest(bytes), entry.sha256, entry.path);
  const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); assert.equal(oid, entry.oid ?? entry.blob, entry.path);
}
for (const entry of auth.originalInputs) {
  const bytes = git(["show", `${candidate}:${entry.path}`]);
  assert.equal(digest(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
  assert.deepEqual(bytes, git(["show", `${auth.identities[0].commit}^:${entry.path}`]));
  assert.deepEqual(bytes, git(["show", `${execution.evidence}:${entry.path}`]));
  assert.equal(digest(git(["show", `${candidate}:${entry.owner.path}`])), entry.owner.sha256);
}
assert.equal(auth.originalInputs.length, 14);
const authorOwner = "tests/integration/du-type-workflow-20260827";
const authorManifest = JSON.parse(git(["show", `${execution.evidence}:${authorOwner}/data/MANIFEST.json`]));
const payload = gunzipSync(Buffer.from(git(["show", `${execution.evidence}:${authorOwner}/data/EVIDENCE.json.gz.base64`]).toString().replace(/\s/gu, ""), "base64"));
assert.equal(digest(payload), authorManifest.payloadSha256);
assert.deepEqual(JSON.parse(payload).map(file => record(file.path, Buffer.from(file.text))), authorManifest.files);
assert.equal(authorManifest.files.length, 65);
assert.equal(digest(readFileSync(join(owned, "receipts/artifacts/candidate.tgz"))), auth.packageTarballSha256);
assert.equal(author.package.before.length, 830); assert.deepEqual(author.package.before, author.package.after);
const variants = [...new Map(auth.originalInputs.map(entry => [entry.sha256, entry])).values()];
assert.equal(variants.length, 2);
for (const [index, entry] of variants.entries()) assert.equal(digest(readFileSync(join(owned, `receipts/fixtures/original-${index}.ts.fixture`))), entry.sha256);
assert.deepEqual(readFileSync(join(owned, "receipts/fixtures/du-leaf.mts.fixture")), git(["show", `${candidate}:tests/plugins/qualified-current-release/du-leaf.mts`]));
assert.equal(digest(readFileSync(join(owned, "receipts/followup/du-leaf.mjs.fixture"))), followupBefore.packageAndConsumer.find(entry => entry.path === "du-leaf.mjs").sha256);
let commandCount = 0;
for (const [prefix, report] of [["receipts", execution], ["receipts/followup", followup]]) {
  for (const command of report.commands) {
    const bytes = gunzipSync(readFileSync(join(owned, prefix, command.file)));
    assert.equal(bytes.length, command.bytes); assert.equal(digest(bytes), command.sha256);
    const raw = JSON.parse(bytes); assert.equal(raw.status, command.status); assert.equal(raw.signal, command.signal);
    assert.equal(typeof raw.stdout, "string"); assert.equal(typeof raw.stderr, "string"); commandCount++;
  }
}
assert.equal(commandCount, 21);
assert.equal(execution.checks.length, 56); assert.equal(execution.checks.filter(entry => entry.status === "pass").length, 54);
assert.deepEqual(execution.failures.map(entry => entry.name), ["direct-nested-reporter-node24", "moved-du-runtime-node24", "source-read-denied", "source refusal is an actual permission failure", "selected Git inputs unchanged and no new selected-tree files"]);
assert.equal(followup.checks.length, 7); assert.deepEqual(followup.failures, []);
assert.ok(followup.checks.every(entry => entry.status === "pass"));
assert.equal(followup.initialExecutionUnchanged.sha256, digest(readFileSync(join(owned, "receipts/execution.json"))));
assert.deepEqual(followupBefore.packageAndConsumer, followupAfter.packageAndConsumer);
const order = entries => [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
assert.deepEqual(order(followupAfter.selectedInputs), order(auth.selectedInputs.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))));
assert.deepEqual(order(followupAfter.packageAndConsumer.filter(entry => entry.path.startsWith("node_modules/virtual-bash/")).map(entry => ({ ...entry, path: entry.path.slice("node_modules/virtual-bash/".length) }))), order(author.package.before));
for (const [runtime, status, pass] of [["node22", 0, 8], ["node24", 1, 7]]) {
  const raw = JSON.parse(gunzipSync(readFileSync(join(owned, `receipts/commands/unchanged-canonical-fixture-${runtime}.json.gz`))));
  assert.equal(raw.status, status); assert.match(raw.stdout, /# tests 8\b/u); assert.match(raw.stdout, new RegExp(`# pass ${pass}\\b`, "u"));
}
for (const runtime of ["node22", "node24"]) {
  const filtered = parse(`receipts/followup/nested-${runtime}/explicit-tap-filtered.json`);
  const unfiltered = parse(`receipts/followup/nested-${runtime}/explicit-tap-unfiltered.json`);
  assert.equal(filtered.status, 0); assert.match(filtered.stdout, /# tests 5\b/u); assert.match(filtered.stdout, /# pass 5\b/u);
  assert.equal(unfiltered.status, 1); assert.match(unfiltered.stdout, /# tests 7\b/u); assert.match(unfiltered.stdout, /# fail 2\b/u);
}
const receipt = { schema: 1, candidate, evidence: execution.evidence, scope: "bounded independent DU type-workflow evidence; unchanged canonical Node24 result remains 7/8", files: records };
if (process.argv[2] === "seal") writeFileSync(join(owned, "MANIFEST.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
else { assert.equal(process.argv[2], "verify"); assert.deepEqual(parse("MANIFEST.json"), receipt); }
console.log(JSON.stringify({ status: "sealed-evidence-verified-not-global-acceptance", files: records.length, bytes: records.reduce((sum, entry) => sum + entry.bytes, 0), authenticatedAuthorFiles: authorManifest.files.length, rawOuterCommands: commandCount, originalInputs: 14, templatesCompiledNotRun: 2, canonicalNode22: "8/8", canonicalNode24: "7/8" }));
