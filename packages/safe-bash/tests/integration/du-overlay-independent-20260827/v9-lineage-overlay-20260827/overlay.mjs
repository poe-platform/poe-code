import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const overlayRoot = dirname(fileURLToPath(import.meta.url));
const deltaPath = join(overlayRoot, "manifest-delta.json");
const patchPath = join(overlayRoot, "verify-v5.patch.data");

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");

function git(repository, args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: null, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.toString()}`);
  }
  return result.stdout;
}

export function assertExactRevision(repository, revision, expected) {
  const resolved = git(repository, ["rev-parse", `${revision}^{commit}`]).toString().trim();
  assert.equal(resolved, expected, `revision must resolve to exact ${expected}`);
  return resolved;
}

function parseHunkHeader(line) {
  const match = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/u.exec(line);
  assert.ok(match, `invalid patch hunk header: ${line}`);
  return match.slice(1).map(Number);
}

export function applyUnifiedPatch(baseBytes, patchBytes) {
  assert.equal(sha256(baseBytes), "447ec395027d6d57902e9c22e5d731519d4205da36ea7256c757b6e9de354cfc", "wrong base verify-v5 bytes");
  const base = baseBytes.toString("utf8");
  const patch = patchBytes.toString("utf8");
  assert.equal(Buffer.from(base).compare(baseBytes), 0, "base harness is not canonical UTF-8");
  assert.equal(Buffer.from(patch).compare(patchBytes), 0, "patch is not canonical UTF-8");
  const patchLines = patch.split("\n");
  assert.deepEqual(patchLines.slice(0, 5), [
    "diff --git a/harness/verify-v5.mjs b/harness/verify-v5.mjs",
    "index 8b48d1b..0000000 100644",
    "--- a/harness/verify-v5.mjs",
    "+++ b/harness/verify-v5.mjs",
    "@@ -233,14 +233,53 @@ function callsMatching(observers, methods) {",
  ], "patch must target only the frozen V5 harness");
  const baseLines = base.split("\n");
  const output = [];
  let baseIndex = 0;
  let patchIndex = 4;
  let hunkCount = 0;
  while (patchIndex < patchLines.length && patchLines[patchIndex] !== "") {
    const [oldStart, oldCount, , newCount] = parseHunkHeader(patchLines[patchIndex++]);
    assert.ok(oldStart - 1 >= baseIndex, "overlapping or out-of-order patch hunks");
    output.push(...baseLines.slice(baseIndex, oldStart - 1));
    baseIndex = oldStart - 1;
    let consumed = 0;
    let produced = 0;
    while (patchIndex < patchLines.length && !patchLines[patchIndex].startsWith("@@ ") && patchLines[patchIndex] !== "") {
      const line = patchLines[patchIndex++];
      const marker = line[0];
      const content = line.slice(1);
      assert.ok(marker === " " || marker === "+" || marker === "-", `invalid patch line marker: ${marker}`);
      if (marker === " " || marker === "-") {
        assert.equal(baseLines[baseIndex], content, "patch context does not match authenticated base");
        baseIndex += 1;
        consumed += 1;
      }
      if (marker === " " || marker === "+") {
        output.push(content);
        produced += 1;
      }
    }
    assert.equal(consumed, oldCount, "patch hunk old-line count mismatch");
    assert.equal(produced, newCount, "patch hunk new-line count mismatch");
    hunkCount += 1;
  }
  assert.equal(hunkCount, 3, "patch must contain exactly three focused hunks");
  assert.equal(patchIndex, patchLines.length - 1, "unexpected patch trailer");
  output.push(...baseLines.slice(baseIndex));
  return Buffer.from(output.join("\n"));
}

export function verifyInventoryRecords(actual, expected, label) {
  const sort = records => [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  assert.deepEqual(sort(actual), sort(expected), `${label} inventory differs from authenticated manifest delta`);
}

async function diskInventory(root) {
  const records = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        assert.ok(entry.isFile(), `materialized fixture contains a non-regular entry: ${path}`);
        const bytes = await readFile(path);
        records.push({
          path: relative(root, path).replaceAll("\\", "/"),
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          gitBlob: gitBlob(bytes),
        });
      }
    }
  }
  await visit(root);
  return records;
}

async function loadInputs() {
  const [deltaBytes, patchBytes] = await Promise.all([readFile(deltaPath), readFile(patchPath)]);
  const delta = JSON.parse(deltaBytes.toString("utf8"));
  assert.equal(delta.schema, 1, "unsupported manifest delta schema");
  assert.equal(sha256(patchBytes), delta.patch.sha256, "patch SHA-256 differs from manifest delta");
  assert.equal(patchBytes.byteLength, delta.patch.bytes, "patch size differs from manifest delta");
  assert.equal(gitBlob(patchBytes), delta.patch.gitBlob, "patch Git blob differs from manifest delta");
  return { delta, patchBytes };
}

function expectedRecords(delta, phase) {
  return [delta.changedFile[phase], ...delta.untouchedFiles].map(record => ({
    path: record.path,
    bytes: record.bytes,
    sha256: record.sha256,
    gitBlob: record.gitBlob,
  }));
}

export async function verifyGitBase(repository = process.cwd()) {
  const { delta, patchBytes } = await loadInputs();
  assertExactRevision(repository, delta.base.commit, delta.base.commit);
  assertExactRevision(repository, delta.candidate.commit, delta.candidate.commit);
  const tree = git(repository, ["rev-parse", `${delta.base.commit}:${delta.base.fixtureRoot}`]).toString().trim();
  assert.equal(tree, delta.base.fixtureTree, "base fixture tree differs from manifest delta");
  const names = git(repository, ["ls-tree", "-r", "--name-only", "-z", delta.base.commit, "--", delta.base.fixtureRoot])
    .toString().split("\0").filter(Boolean).map(path => path.slice(delta.base.fixtureRoot.length + 1));
  assert.deepEqual(names.sort(), expectedRecords(delta, "base").map(record => record.path).sort(), "base fixture inventory differs");
  const actual = [];
  for (const expected of expectedRecords(delta, "base")) {
    const bytes = git(repository, ["show", `${delta.base.commit}:${delta.base.fixtureRoot}/${expected.path}`]);
    actual.push({ path: expected.path, bytes: bytes.byteLength, sha256: sha256(bytes), gitBlob: gitBlob(bytes) });
  }
  verifyInventoryRecords(actual, expectedRecords(delta, "base"), "Git base");
  const manifest = actual.find(record => record.path === "MANIFEST.json");
  assert.equal(manifest.sha256, delta.base.manifestSha256, "base manifest SHA-256 differs");
  const baseHarness = git(repository, ["show", `${delta.base.commit}:${delta.base.fixtureRoot}/${delta.changedFile.base.path}`]);
  const patched = applyUnifiedPatch(baseHarness, patchBytes);
  assert.deepEqual({
    path: delta.changedFile.overlay.path,
    bytes: patched.byteLength,
    sha256: sha256(patched),
    gitBlob: gitBlob(patched),
  }, delta.changedFile.overlay, "patched harness identity differs from manifest delta");
  return { delta, patchBytes, patched };
}

export async function verifyMaterialized(root, phase) {
  assert.ok(phase === "base" || phase === "overlay", "phase must be base or overlay");
  const { delta } = await loadInputs();
  const rootStat = await stat(root);
  assert.ok(rootStat.isDirectory(), "materialized fixture root must be a directory");
  verifyInventoryRecords(await diskInventory(root), expectedRecords(delta, phase), `materialized ${phase}`);
  return delta;
}

export async function applyOverlay(root, repository = process.cwd()) {
  const absoluteRoot = resolve(root);
  const { delta, patched } = await verifyGitBase(repository);
  await verifyMaterialized(absoluteRoot, "base");
  const target = join(absoluteRoot, delta.changedFile.base.path);
  const temporary = `${target}.v9-lineage-overlay-${process.pid}`;
  try {
    await writeFile(temporary, patched, { flag: "wx", mode: 0o644 });
    await rename(temporary, target);
    await verifyMaterialized(absoluteRoot, "overlay");
  } finally {
    await rm(temporary, { force: true });
  }
  return delta;
}

async function main() {
  const command = process.argv[2] ?? "verify";
  if (command === "verify" && process.argv.length === 3) {
    const { delta } = await verifyGitBase();
    process.stdout.write(`${JSON.stringify({ ok: true, command, base: delta.base.commit, candidate: delta.candidate.commit })}\n`);
    return;
  }
  if (command === "apply" && process.argv.length === 4) {
    const delta = await applyOverlay(process.argv[3]);
    process.stdout.write(`${JSON.stringify({ ok: true, command, root: resolve(process.argv[3]), changed: delta.changedFile.overlay })}\n`);
    return;
  }
  throw new Error("usage: node overlay.mjs verify | node overlay.mjs apply MATERIALIZED_FIXTURE_ROOT");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
