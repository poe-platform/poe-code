import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../../..");
const [cohort, revision] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.match(cohort, /^[a-z][a-z0-9-]*$/);
assert.match(revision, /^[a-f0-9]{40}$/);
const evidence = join(directory, cohort);
assert.equal(existsSync(evidence), false);
mkdirSync(evidence);
const scratch = mkdtempSync(join(directory, ".frozen-"));
const sourceOverrides = ["src/fs/mount/index.ts", "src/fs/overlay/index.ts"];
const newTests = ["mount", "overlay", "readonly"].map(name => `tests/fs/${name}/snapshot-rmdir.test.ts`);
const topLevelRoots = ["tests/fs/mount", "tests/fs/overlay", "tests/fs/readonly"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
function git(...args) {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
const sourcePaths = git("ls-tree", "-r", "--name-only", revision, "--", "src").toString().trim().split("\n");
const testPaths = git("ls-tree", "-r", "--name-only", revision, "--", ...topLevelRoots).toString().trim().split("\n")
  .filter(path => path.endsWith(".ts") && topLevelRoots.includes(dirname(path)));
const paths = [...sourcePaths, ...testPaths, "tests/fs/webdav/mock.ts", "tests/fs/webdav/property-fixture.ts", "tests/fs/real/helpers.ts",
  "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].sort();
const overrides = new Map([...sourceOverrides, ...newTests].map(path => [path, readFileSync(join(root, path))]));
const allPaths = [...new Set([...paths, ...newTests])].sort();
function manifest() {
  return allPaths.map(path => ({ path, sha256: sha256(readFileSync(join(scratch, path))) }));
}
const results = [];
function run(name, args, expectedStatus, expectedTests) {
  const before = manifest();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    cwd: scratch, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TSX_DISABLE_CACHE: "1", TMPDIR: scratch },
  });
  writeFileSync(join(evidence, `${name}.stdout.log`), result.stdout ?? "", { flag: "wx" });
  writeFileSync(join(evidence, `${name}.stderr.log`), result.stderr ?? "", { flag: "wx" });
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key =>
    [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(result.stdout ?? "")?.[1] ?? -1)]));
  const receipt = { name, argv: [process.execPath, ...args], cwd: scratch, startedAt, elapsedMs: performance.now() - started,
    status: result.status, signal: result.signal, error: result.error?.message ?? null, counts,
    failures: [...(result.stdout ?? "").matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]),
    sourceHash: sha256(JSON.stringify(before.filter(entry => entry.path.startsWith("src/")))),
    inputHash: sha256(JSON.stringify(before)), unchanged: JSON.stringify(before) === JSON.stringify(manifest()) };
  save(`${name}.json`, receipt);
  results.push(receipt);
  console.log(JSON.stringify(receipt));
  assert.equal(result.error, undefined);
  assert.equal(result.status, expectedStatus);
  assert.equal(receipt.unchanged, true);
  if (expectedTests !== undefined) assert.equal(counts.tests, expectedTests);
  if (counts.tests >= 0) {
    assert.equal(counts.cancelled, 0);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.todo, 0);
  }
}
try {
  const archive = git("archive", "--format=tar.gz", revision, "--", ...paths);
  writeFileSync(join(evidence, "committed-inputs.tar.gz"), archive, { flag: "wx" });
  const extracted = spawnSync("tar", ["-xzf", join(evidence, "committed-inputs.tar.gz"), "-C", scratch]);
  assert.equal(extracted.status, 0);
  for (const path of paths) assert.deepEqual(readFileSync(join(scratch, path)), git("show", `${revision}:${path}`));
  for (const path of newTests) writeFileSync(join(scratch, path), overrides.get(path));
  save("baseline-inputs.json", manifest());
  const provenance = { revision, capturedAt: new Date().toISOString(), liveHead: git("rev-parse", "HEAD").toString().trim(),
    liveStatus: git("status", "--porcelain=v1").toString(), node: process.version, platform: process.platform, arch: process.arch,
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), archiveSha256: sha256(archive),
    overrideHashes: [...overrides].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
    toolchain: ["tsx", "esbuild", "typescript", "@types/node"].map(name => ({ name,
      version: JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"))).version })),
    policy: "Committed base plus only named owned overrides; no moving foreign source, install, native provider replay or global build output. Local development dependency trees are not frozen." };
  save("provenance.json", provenance);
  for (const [path, bytes] of overrides) {
    const destination = join(evidence, "overrides", `${path}.txt`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: "wx" });
  }
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap"];
  run("baseline-new16", [...testArgs, ...newTests], 1, 16);
  for (const path of sourceOverrides) writeFileSync(join(scratch, path), overrides.get(path));
  save("candidate-inputs.json", manifest());
  run("candidate-new16", [...testArgs, ...newTests], 0, 16);
  run("original-alias49", [...testArgs, "tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"], 0, 49);
  run("original-alias4", [...testArgs, "tests/fs/mount/copy-identity.test.ts"], 0, 4);
  const oldRmdir = testPaths.filter(path => /\/rmdir(?:-static-lower)?\.test\.ts$/.test(path));
  run("existing-rmdir", [...testArgs, ...oldRmdir], 0);
  const wrapperTests = testPaths.filter(path => path.endsWith(".test.ts"));
  run("existing-wrappers", [...testArgs, ...wrapperTests], 0);
  run("scoped-types", [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--lib", "ES2023",
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes",
    "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...wrapperTests, ...newTests], 0);
  run("archived-build", [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], 0);
  function generatedFiles(directory = "dist") {
    return readdirSync(join(scratch, directory), { withFileTypes: true }).flatMap(entry => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? generatedFiles(path) : [{ path, sha256: sha256(readFileSync(join(scratch, path))) }];
    });
  }
  save("generated.json", generatedFiles());
  save("summary.json", { revision, results, original79NotRun: true, oldExpectationsChanged: false });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
