import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const review = dirname(fileURLToPath(import.meta.url));
const root = resolve(review, "../../../..");
const [cohort, sourceRevision, inputRevision, helperRevision] = process.argv.slice(2);
assert.equal(process.argv.length, 6, "usage: capture.mjs NEW-COHORT SOURCE-COMMIT INPUT-COMMIT HELPER-COMMIT");
assert.match(cohort, /^[a-z][a-z0-9-]*$/);
for (const revision of [sourceRevision, inputRevision, helperRevision]) assert.match(revision, /^[a-f0-9]{40}$/);
const evidence = join(review, cohort);
assert.equal(existsSync(evidence), false, "never overwrite captured evidence");
const fixturePath = "tests/integration/adapter-tools/fixtures.ts";
const matrixPath = "tests/integration/adapter-tools/matrix.test.ts";
const preflightPath = "tests/integration/adapter-tools/preflight-review/preflight.ts";
const controlPath = "tests/integration/adapter-tools/preflight-review/preflight.test.ts";
const helperPath = "tests/fs/webdav/mock.ts";
const groups = [
  { name: "source", revision: sourceRevision, paths: ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"] },
  { name: "input", revision: inputRevision, paths: [fixturePath, matrixPath, preflightPath, controlPath] },
  { name: "helper", revision: helperRevision, paths: [helperPath] },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

function save(name, value) {
  writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

for (const group of groups) {
  assert.equal(git("rev-parse", `${group.revision}^{commit}`).toString().trim(), group.revision);
}
mkdirSync(evidence);
const snapshot = mkdtempSync(join(review, ".archive-"));
const manifest = [];
const archives = [];
const results = [];

function currentManifest() {
  return manifest.map(entry => {
    const bytes = readFileSync(join(snapshot, entry.path));
    return { ...entry, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function generatedManifest(directory = "dist") {
  return readdirSync(join(snapshot, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) return generatedManifest(path);
    const bytes = readFileSync(join(snapshot, path));
    return [{ path, bytes: bytes.length, sha256: sha256(bytes) }];
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function run(name, args, expectedTests) {
  assert.deepEqual(currentManifest(), manifest, `${name}: unchanged archived inputs before run`);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const output = spawnSync(process.execPath, args, {
    cwd: snapshot, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TSX_DISABLE_CACHE: "1", TMPDIR: snapshot },
  });
  writeFileSync(join(evidence, `${name}.stdout.log`), output.stdout ?? "", { flag: "wx" });
  writeFileSync(join(evidence, `${name}.stderr.log`), output.stderr ?? "", { flag: "wx" });
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const match = output.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, "m"));
    return [key, match ? Number(match[1]) : null];
  }));
  const cases = [...(output.stdout ?? "").matchAll(/^(ok|not ok) (\d+) - (.+)$/gm)]
    .map(match => ({ number: Number(match[2]), name: match[3], passed: match[1] === "ok" }));
  const result = {
    name, argv: [process.execPath, ...args], cwd: snapshot, startedAt,
    elapsedMs: performance.now() - started, status: output.status, signal: output.signal,
    error: output.error?.message ?? null, counts, cases,
    failures: cases.filter(entry => !entry.passed).map(entry => entry.name),
    unchangedInputsAfter: JSON.stringify(currentManifest()) === JSON.stringify(manifest),
  };
  save(`${name}.result.json`, result);
  results.push(result);
  assert.equal(result.unchangedInputsAfter, true);
  assert.equal(output.error, undefined, `${name}: subprocess completed`);
  assert.equal(output.signal, null, `${name}: subprocess was not killed`);
  if (expectedTests !== undefined) {
    assert.equal(counts.tests, expectedTests, `${name}: original denominator`);
    assert.equal(counts.cancelled, 0);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.todo, 0);
    assert.equal(cases.length, expectedTests);
    assert.equal(counts.pass + counts.fail, expectedTests);
    assert.equal(cases.filter(entry => entry.passed).length, counts.pass);
    assert.equal(output.status, counts.fail ? 1 : 0);
  } else assert.equal(output.status, 0, `${name}: successful probe`);
  console.log(JSON.stringify({ name, status: result.status, counts, failures: result.failures }));
  return output.stdout;
}

try {
  for (const group of groups) {
    const archive = git("archive", "--format=tar.gz", group.revision, "--", ...group.paths);
    const archiveName = `${group.name}.tar.gz`;
    const archivePath = join(evidence, archiveName);
    writeFileSync(archivePath, archive, { flag: "wx" });
    const listing = git("ls-tree", "-r", "-z", group.revision, "--", ...group.paths).toString().split("\0").filter(Boolean);
    const entries = listing.map(line => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      assert.ok(match, `regular committed file: ${line}`);
      const path = match[3];
      assert.equal(path.split("/").includes(".."), false);
      assert.equal(path.startsWith("/"), false);
      assert.equal(manifest.some(entry => entry.path === path), false, `disjoint archive: ${path}`);
      return { group: group.name, revision: group.revision, path, gitBlob: match[2] };
    });
    const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", snapshot], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const entry of entries) {
      const bytes = readFileSync(join(snapshot, entry.path));
      assert.deepEqual(bytes, git("cat-file", "blob", entry.gitBlob), `archive matches committed blob: ${entry.path}`);
      manifest.push({ ...entry, bytes: bytes.length, sha256: sha256(bytes) });
    }
    archives.push({ ...group, file: archiveName, bytes: archive.length, sha256: sha256(archive) });
  }
  manifest.sort((left, right) => left.path.localeCompare(right.path, "en"));
  save("inputs.json", manifest);
  writeFileSync(join(evidence, "helper-delta.diff"), git("diff", inputRevision, helperRevision, "--", helperPath), { flag: "wx" });
  const toolchain = ["tsx", "esbuild", "typescript", "@types/node"].map(name => {
    const bytes = readFileSync(join(root, "node_modules", name, "package.json"));
    return { name, version: JSON.parse(bytes).version, packageJsonSha256: sha256(bytes) };
  });
  const metadata = {
    capturedAt: new Date().toISOString(), sourceRevision, inputRevision, helperRevision,
    sourceTree: git("rev-parse", `${sourceRevision}:src`).toString().trim(),
    liveHeadAtCapture: git("rev-parse", "HEAD").toString().trim(),
    liveStatusAtCapture: git("status", "--porcelain=v1").toString(),
    archivedCommittedFilesOnly: true, archives,
    buildProfile: "Build archived source using its tsconfig.build.json before matrix execution; source-mode regex client requires the resulting dist worker.",
    inputHash: sha256(JSON.stringify(manifest)),
    groupHashes: Object.fromEntries(groups.map(group => [group.name, sha256(JSON.stringify(manifest.filter(entry => entry.group === group.name)))])),
    node: { version: process.version, executable: process.execPath, sha256: sha256(readFileSync(process.execPath)), versions: process.versions },
    platform: process.platform, arch: process.arch, toolchain,
    toolchainPolicy: "Existing local development dependencies resolved from repository node_modules; no install; package metadata hashed, entire dependency trees not frozen.",
    subprocessEnvironmentOverrides: { NO_COLOR: "1", FORCE_COLOR: "0", TSX_DISABLE_CACHE: "1", TMPDIR: snapshot },
    networkProfile: "S3 in-process MockS3Client; WebDAV MockDav over loopback HTTP; no native provider replay or external oracle.",
    cohostLoad: "Other authors active; elapsed time is execution metadata, not a performance comparison.",
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  };
  save("capture.json", metadata);
  run("archived-build", [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"]);
  const generated = generatedManifest();
  save("generated.json", generated);
  const probe = run("required-commands", ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "-e",
    `import { requiredWorkflowCommands } from './${preflightPath}'; import { withFixture } from './${fixturePath}'; const names = [...new Set(Object.values(requiredWorkflowCommands).flat())].sort(); await withFixture('memory', async ({ shell }) => { console.log(JSON.stringify({ requiredNames: names, requiredNameCount: names.length, executableRequiredNameCount: names.filter(name => typeof shell.commands.get(name)?.execute === 'function').length, plugin: 'actual agentCommands() through existing withFixture' })); });`,
  ]);
  save("required-commands.json", JSON.parse(probe));
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap"];
  run("original79", [...testArgs, matrixPath], 79);
  run("preflight-controls", [...testArgs, controlPath], 30);
  assert.deepEqual(generatedManifest(), generated, "generated build outputs unchanged after tests");
  save("summary.json", {
    sourceRevision, inputRevision, helperRevision, inputHash: metadata.inputHash, groupHashes: metadata.groupHashes,
    generatedHash: sha256(JSON.stringify(generated)),
    requiredCommands: JSON.parse(probe), results,
    verification: { archivedInputsUnchanged: true, originalMatrixAssertionsUnmodified: true, expectedPassCountNotAsserted: true },
  });
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
