import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const review = dirname(fileURLToPath(import.meta.url));
const root = resolve(review, "../../../..");
const cohort = process.argv[2] ?? "evidence";
assert.match(cohort, /^[a-z][a-z0-9-]*$/, "cohort must be a new direct child directory name");
const evidence = join(review, cohort);
const fixturePath = "tests/integration/adapter-tools/fixtures.ts";
const matrixPath = "tests/integration/adapter-tools/matrix.test.ts";
const controlPath = "tests/integration/adapter-tools/preflight-review/preflight.test.ts";
const preflightPath = "tests/integration/adapter-tools/preflight-review/preflight.ts";
const oldRevision = "33ddb70";
assert.equal(existsSync(evidence), false, "retain prior evidence; do not overwrite a captured cohort");
mkdirSync(evidence);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function filesUnder(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = `${directory}/${entry.name}`;
    assert.equal(entry.isSymbolicLink(), false, `no source symlink: ${name}`);
    return entry.isDirectory() ? filesUnder(name) : [name];
  });
}

function manifest(base, paths) {
  return paths.map(path => {
    const full = join(base, path);
    assert.ok(lstatSync(full).isFile(), `regular input: ${path}`);
    const bytes = readFileSync(full);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function fingerprint(entries) {
  return sha256(JSON.stringify(entries));
}

function save(name, value) {
  writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
}

const paths = [
  ...filesUnder("src"), "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
  "tests/fs/webdav/mock.ts", fixturePath, matrixPath, controlPath, preflightPath,
].sort();
const capturedAt = new Date().toISOString();
const head = git("rev-parse", "HEAD").trim();
const status = git("status", "--porcelain=v1");
const beforeCopy = manifest(root, paths);
const source = beforeCopy.filter(entry => entry.path.startsWith("src/"));
const snapshot = mkdtempSync(join(review, ".frozen-"));
const oldFixture = git("show", `${oldRevision}:${fixturePath}`);
const newFixture = readFileSync(join(root, fixturePath), "utf8");
assert.equal(sha256(oldFixture), "59ac2d1835ff329d0bbd08e3ae28bc8c656145e5bb568e6dbca0e851367cb3ab", "pinned old fixture");
const oldInputs = beforeCopy.map(entry => entry.path === fixturePath
  ? { path: fixturePath, bytes: Buffer.byteLength(oldFixture), sha256: sha256(oldFixture) }
  : entry);
writeFileSync(join(evidence, "fixture-before.txt"), oldFixture);
writeFileSync(join(evidence, "fixture-after.txt"), newFixture);
writeFileSync(join(evidence, "fixture.diff"), git("diff", "--", fixturePath));
writeFileSync(join(evidence, "worktree-status-before.txt"), status);
writeFileSync(join(evidence, "source-dirty.diff"), git("diff", "HEAD", "--", "src"));
const untrackedSource = git("ls-files", "--others", "--exclude-standard", "--", "src").trim().split("\n").filter(Boolean);
save("untracked-source.json", untrackedSource.map(path => ({ path, contents: readFileSync(join(root, path), "utf8") })));
save("inputs.json", {
  capturedAt, head, snapshot, oldFixtureRevision: git("rev-parse", oldRevision).trim(),
  inputHash: fingerprint(beforeCopy), sourceHash: fingerprint(source), oldInputHash: fingerprint(oldInputs),
  oldFixtureHash: sha256(oldFixture), newFixtureHash: sha256(newFixture),
  hashAlgorithm: "SHA-256 of JSON.stringify(sorted [{path,bytes,sha256}]); sourceHash restricts to src/",
  node: process.version, platform: process.platform, arch: process.arch, execPath: process.execPath,
  dependencies: ["tsx", "typescript", "esbuild", "@types/node"].map(name => {
    const bytes = readFileSync(join(root, "node_modules", name, "package.json"));
    return { name, version: JSON.parse(bytes).version, packageJsonHash: sha256(bytes) };
  }),
  files: beforeCopy,
});

const results = [];
function run(name, args, expectedInputs, expectedTests) {
  assert.deepEqual(manifest(snapshot, paths), expectedInputs, `${name}: inputs before execution`);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const output = spawnSync(process.execPath, args, {
    cwd: snapshot, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  writeFileSync(join(evidence, `${name}.stdout.log`), output.stdout ?? "");
  writeFileSync(join(evidence, `${name}.stderr.log`), output.stderr ?? "");
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const match = output.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, "m"));
    return [key, match ? Number(match[1]) : null];
  }));
  const failures = [...(output.stdout ?? "").matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  const result = {
    name, argv: [process.execPath, ...args], cwd: snapshot, startedAt,
    elapsedMs: performance.now() - started, status: output.status, signal: output.signal,
    error: output.error?.message ?? null, inputHash: fingerprint(expectedInputs),
    sourceHash: fingerprint(source), counts, failures,
    unchangedInputsAfter: JSON.stringify(manifest(snapshot, paths)) === JSON.stringify(expectedInputs),
  };
  save(`${name}.result.json`, result);
  results.push(result);
  assert.equal(result.unchangedInputsAfter, true, `${name}: inputs after execution`);
  assert.equal(output.error, undefined, `${name}: subprocess must complete`);
  if (expectedTests !== undefined) {
    assert.equal(counts.tests, expectedTests, `${name}: complete test denominator`);
    assert.equal(counts.cancelled, 0);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.todo, 0);
  }
  console.log(JSON.stringify({ name, status: output.status, counts, failures }));
}

try {
  for (const path of paths) {
    mkdirSync(dirname(join(snapshot, path)), { recursive: true });
    copyFileSync(join(root, path), join(snapshot, path));
  }
  assert.deepEqual(manifest(root, paths), beforeCopy, "live inputs unchanged across copy");
  assert.deepEqual(manifest(snapshot, paths), beforeCopy, "frozen regular copies match live inputs");
  writeFileSync(join(snapshot, fixturePath), oldFixture);
  run("old-preflight-matrix", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", matrixPath], oldInputs, 79);
  writeFileSync(join(snapshot, fixturePath), newFixture);
  run("required-preflight-matrix", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", matrixPath], beforeCopy, 79);
  run("preflight-controls", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", controlPath], beforeCopy, 30);
  run("scoped-typecheck", [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--lib", "ES2023",
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess",
    "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames",
    "--skipLibCheck", "--types", "node", fixturePath, matrixPath, controlPath, preflightPath], beforeCopy);
  save("summary.json", { head, sourceHash: fingerprint(source), results });
  const liveAfter = manifest(root, paths);
  save("after.json", {
    capturedAt: new Date().toISOString(), head: git("rev-parse", "HEAD").trim(),
    frozenInputsUnchanged: JSON.stringify(manifest(snapshot, paths)) === JSON.stringify(beforeCopy),
    liveInputHash: fingerprint(liveAfter), liveSourceHash: fingerprint(liveAfter.filter(entry => entry.path.startsWith("src/"))),
    liveChanges: liveAfter.filter((entry, index) => entry.sha256 !== beforeCopy[index].sha256),
    liveNewSourcePaths: filesUnder("src").filter(path => !paths.includes(path)),
    snapshotRemovedAfterRun: true,
  });
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
