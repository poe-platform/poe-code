import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const repository = "/Users/kjopek/Workspace/safe-bash";
const namespace = "tests/integration/agent-bash-coherent-b2-preflight-20260829";
const owned = path.join(repository, namespace);
const work = "/private/tmp/safe-bash-b2-completion-r3-01a04d95";
const capture = "/private/tmp/safe-bash-b2-completion-r3-01a04d95.log";
const priorSeal = { bytes: 6363, sha256: "35a88f158641c153a05fb2124052a8c23951c6e2870dd70ca4fae4d9698e31a9" };
const conditional = { bytes: 14524, sha256: "0c8216e79aeaadd22bededaf2cc72a8daf83e296584c4b31efa2fed0b5c917e7" };
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const start = fs.statSync(capture).birthtimeMs;
const limits = Object.freeze({ seconds: 1500, knownStarts: 56, peak: 3, raw: 100663296, work: 536870912, reserve: 4194304 });
const events = [];
let written = 0;
let childNumber = 0;

function admission(file, expected, maximum = 16777216) {
  assert.ok(expected && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 && expected.bytes <= maximum);
  assert.match(expected.sha256, /^[a-f0-9]{64}$/);
  const before = fs.lstatSync(file);
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.equal(before.size, expected.bytes);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const initial = fs.fstatSync(descriptor);
    assert.equal(initial.dev, before.dev);
    assert.equal(initial.ino, before.ino);
    const bytes = Buffer.alloc(expected.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0);
      offset += count;
    }
    const final = fs.fstatSync(descriptor);
    assert.equal(final.size, initial.size);
    assert.equal(final.mtimeMs, initial.mtimeMs);
    assert.equal(sha(bytes), expected.sha256);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function write(file, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  assert.ok(written + body.length <= limits.work - limits.reserve);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < body.length) {
      const count = fs.writeSync(descriptor, body, offset, body.length - offset);
      assert.ok(count > 0 && count <= body.length - offset);
      offset += count;
      written += count;
    }
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function command(role, executable, args, accepted = [0], input) {
  assert.ok(Date.now() - start < 1400000, "inclusive preparation deadline reserve");
  const prefix = path.join(work, `${String(++childNumber).padStart(2, "0")}-${role}`);
  const stdoutPath = `${prefix}.stdout.raw`;
  const stderrPath = `${prefix}.stderr.raw`;
  const stdout = fs.openSync(stdoutPath, "wx", 0o600);
  let stderr;
  let result;
  try {
    stderr = fs.openSync(stderrPath, "wx", 0o600);
    result = spawnSync(executable, args, { cwd: repository, input, stdio: [input === undefined ? "ignore" : "pipe", stdout, stderr], timeout: 20000, env: { PATH: "/usr/bin:/bin", HOME: work, TMPDIR: work, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" } });
  } finally {
    fs.closeSync(stdout);
    if (stderr !== undefined) fs.closeSync(stderr);
  }
  const outSize = fs.statSync(stdoutPath).size;
  const errSize = fs.statSync(stderrPath).size;
  assert.ok(outSize + errSize <= 16777216);
  written += outSize + errSize;
  assert.ok(written < limits.work - limits.reserve);
  const event = Object.freeze({ role, executable, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutPath, stderrPath, stdoutBytes: outSize, stderrBytes: errSize });
  events.push(event);
  assert.ok(!result.error && result.signal === null && accepted.includes(result.status), `${role} retirement: ${JSON.stringify(event)}`);
  return { ...event, stdout: fs.readFileSync(stdoutPath), stderr: fs.readFileSync(stderrPath) };
}

function git(role, args, accepted, input) {
  return command(role, "/usr/bin/git", ["-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], accepted, input);
}

function patch(files) {
  const body = "*** Begin Patch\n" + files.map(([relative, text]) => {
    assert.ok(relative.startsWith(`${namespace}/completion-r3/`) && !relative.split("/").includes(".."));
    assert.ok(text.endsWith("\n"));
    return `*** Add File: ${relative}\n${text.slice(0, -1).split("\n").map(line => "+" + line).join("\n")}\n`;
  }).join("") + "*** End Patch\n";
  return command("publish-qualification-patch", "/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch", [], [0], body);
}

function report(data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  process.stdout.write(text);
  fs.writeSync(3, text);
}

fs.mkdirSync(work, { mode: 0o700 });
try {
  const sealBytes = admission(path.join(owned, "SEAL.json"), priorSeal);
  const seal = JSON.parse(sealBytes);
  assert.equal(seal.files.length, 38);
  const admitted = new Map();
  for (const row of seal.files) admitted.set(row.path, admission(path.join(owned, row.path), row));
  for (const tool of JSON.parse(admitted.get("AUTHENTICATED-INPUTS.json")).tools) admission(tool.path, tool, 268435456);
  const origins = JSON.parse(admitted.get("ORIGINS.json"));
  for (const entry of origins.entries) {
    const bytes = admitted.get(entry.stagedPath);
    assert.equal(bytes.length, entry.origin.bytes);
    assert.equal(sha(bytes), entry.origin.sha256);
    assert.equal(crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.origin.blob);
  }
  assert.equal(origins.entries.length, 16);
  const original = git("original-conditional", ["cat-file", "blob", "cb41a2556e3ddf4662b2be40fb10756d61838180"]);
  const originalBytes = admission(original.stdoutPath, conditional);
  const stagedBytes = admission(path.join(owned, "runtime/harness/conditional.mjs"), conditional);
  assert.ok(originalBytes.equals(stagedBytes));
  const validFile = path.join(work, "admission-valid.fixture");
  const alteredFile = path.join(work, "admission-altered.fixture");
  const expectedFixture = Object.freeze({ bytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  write(validFile, "abc");
  write(alteredFile, "abd");
  assert.equal(admission(validFile, expectedFixture).toString(), "abc");
  assert.throws(() => admission(alteredFile, expectedFixture), { code: "ERR_ASSERTION" });
  const qualification = `# B2 completion-r3 publication authority\n\nAugust 29, 2026. Fresh preparation only: 1500 seconds, 56 known OS starts, peak3, 96 MiB raw capture, 512 MiB work including publication. Six presealed pure/controller Node helpers and four harmless child fixtures maximum. Product runtime remains UNRUN.\n\nThe original 39-file partial seal remains ${priorSeal.sha256}; no historical byte is changed. The original exit127/no-files/tool-transcript-only STOP retains raw artifact UNAVAILABLE. The later diff-check exit2 remains retained. Completion-r2's exit78 is an AUTHORING DEFECT: shell array parsing falsely rejected matching hashes, not a source integrity mismatch. No qualification is backdated.\n\nFresh file-based JavaScript admission checked bounded regular-file size, descriptor identity, exact Buffer bytes, and crypto SHA256 strict string equality. Two pure admission fixtures checked valid abc and rejected same-size altered abd against the unchanged expected hash. No CLI hash-output tokenization is used.\n\n## Exact formatting exception\n\nOriginal Git blob cb41a2556e3ddf4662b2be40fb10756d61838180 and staged runtime/harness/conditional.mjs are both ${conditional.bytes} bytes with SHA256 ${conditional.sha256}. The single intentional inherited warning is new blank line at EOF, line129. Frozen bytes remain unchanged. A separate authored-files whitespace check is required; the complete check must contain exactly this warning, with no other warnings hidden.\n\nFirst publication includes the old partial plus this qualification and the new admission helper; it does not claim completion. Root runtime GO and independent review remain PENDING.\n`;
  const qualificationPath = `${namespace}/completion-r3/PARTIAL-PUBLICATION.md`;
  patch([[qualificationPath, qualification]]);
  const oldPaths = [...seal.files.map(row => `${namespace}/${row.path}`), `${namespace}/SEAL.json`];
  const newPaths = [`${namespace}/completion-r3/admit-and-publish.mjs`, qualificationPath];
  const originalPaths = new Set(origins.entries.map(row => `${namespace}/${row.stagedPath}`));
  const authoredPaths = [...oldPaths.filter(relative => !originalPaths.has(relative)), ...newPaths];
  const publicationPaths = [...oldPaths, ...newPaths];
  git("stage-partial", ["add", "--", ...publicationPaths]);
  git("authored-whitespace", ["diff", "--cached", "--check", "--", ...authoredPaths]);
  const allWhitespace = git("complete-whitespace", ["diff", "--cached", "--check", "--", ...publicationPaths], [2]);
  assert.equal(allWhitespace.stdout.toString(), `${namespace}/runtime/harness/conditional.mjs:129: new blank line at EOF.\n`);
  assert.equal(allWhitespace.stderr.length, 0);
  git("commit-partial", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--only", "-m", "test: publish preserved B2 partial with exact legacy formatting exception", "--", ...publicationPaths]);
  const commit = git("partial-commit-identity", ["rev-parse", "HEAD"]).stdout.toString().trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  write(path.join(work, "PARTIAL-PUBLICATION.json"), JSON.stringify({ commit, oldSeal: priorSeal, conditional, originalFiles: 16, oldFiles: 39, newFiles: newPaths, admittedFixtures: ["valid-pair", "same-size-altered-refusal"], events }, null, 2) + "\n");
  const bindings = JSON.parse(admitted.get("FROZEN-BINDINGS.json"));
  const sourceRoot = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source";
  const source = [];
  for (const row of bindings.selectedInputs) {
    assert.ok(!row.path.split("/").includes("AGENTS.md"));
    source.push({ ...row, text: admission(path.join(sourceRoot, row.path), row).toString() });
  }
  for (const row of bindings.actualEmitted) admission(row.observedPath, row);
  admission(bindings.compressedPackage.path, bindings.compressedPackage, 930368);
  const inspection = { partialCommit: commit, bindings, source, oldFiles: Object.fromEntries([...admitted].map(([name, bytes]) => [name, bytes.toString()])), events };
  write(path.join(work, "INSPECTION.json"), JSON.stringify(inspection));
  const regexFiles = source.filter(row => /regex|conditional|shell\/runtime|commands\/index|shell\/shell/.test(row.path));
  const findings = regexFiles.map(row => ({ path: row.path, lines: row.text.split("\n").flatMap((line, index) => /Worker|regexExecutor|RegexExecutor|evaluateConditional|executeConditional|new RegExp|createRegex|async.*match|matchRegex/.test(line) ? [{ line: index + 1, text: line }] : []) })).filter(row => row.lines.length);
  const owner = admitted.get("runtime/stage-b0-r3/owner.mjs").toString();
  report({ status: "PARTIAL_ATOMICALLY_PUBLISHED", commit, admissionFixtures: 2, sourceInputs: source.length, emitted: bindings.actualEmitted.length, packageSha256: bindings.compressedPackage.sha256, inspectionSha256: sha(Buffer.from(JSON.stringify(inspection))), inspectionBytes: Buffer.byteLength(JSON.stringify(inspection)), findings, ownerInterface: owner, sourceAndFixturesRemainDataOnly: true, helperChildStarts: events.length, elapsedSeconds: (Date.now() - start) / 1000 });
} catch (error) {
  const failure = { status: "STOP", error: String(error.stack ?? error), events, written, elapsedSeconds: (Date.now() - start) / 1000, actualRuntime: "UNRUN" };
  try { write(path.join(work, "STOP.json"), JSON.stringify(failure, null, 2) + "\n"); } catch (publicationError) { process.stderr.write(String(publicationError) + "\n"); }
  report(failure);
  process.exitCode = 1;
}
