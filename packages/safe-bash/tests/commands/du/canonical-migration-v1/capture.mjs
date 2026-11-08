import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, "../../../..");
const candidate = process.argv[2];
assert.match(candidate ?? "", /^[a-f0-9]{40}$/u);
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const committed = path => git("show", `${candidate}:${path}`);
for (const prerequisite of ["32c5b60c", "1c793b93", "0d6b9fcf", "9a5a6f92"]) git("merge-base", "--is-ancestor", prerequisite, candidate);
const seal = JSON.parse(readFileSync(join(evidence, "ORIGINALS.json")));
for (const [path, pin] of Object.entries(seal.productPins)) assert.equal(digest(committed(path)), pin.sha256, path);
const tracked = git("ls-tree", "-r", "--name-only", candidate).toString().trim().split("\n");
const du = tracked.filter(path => path.startsWith("tests/commands/du/") && path.endsWith(".test.ts") && !/\/(evidence|independent)\//u.test(path));
const overlayDriverPath = "tests/fs/overlay/metadata-purity-evidence/capture.mjs";
const overlayDriver = committed(overlayDriverPath).toString();
const selection = name => [...overlayDriver.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`, "u"))[1].matchAll(/"([^"]+)"/gu)].map(match => match[1]);
const strict = selection("strict");
const focused = selection("focused");
const overlayManifestPath = "tests/fs/overlay/metadata-purity-evidence/captures/migrated-ss88qj/manifest-before.json";
const overlayInputs = Object.keys(JSON.parse(committed(overlayManifestPath)));
const paths = [...new Set([
  ...tracked.filter(path => path.startsWith("src/")), ...overlayInputs,
  ...tracked.filter(path => /^tests\/commands\/du\/(?:functional-v1\/)?[^/]+\.(?:ts|json)$/u.test(path)),
  "tests/commands/du/functional-v1/verify-built.mjs",
])].sort();
for (const entry of [...du, ...strict, ...focused]) assert.ok(paths.includes(entry), entry);
const output = mkdtempSync(join(evidence, "combined-v1-"));
const runtime = mkdtempSync(join(evidence, ".runtime-"));
const save = (name, value) => writeFileSync(join(output, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const inventory = (directory, excluded = new Set()) => {
  const result = {};
  if (!existsSync(directory)) return result;
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(current, entry.name), path = relative(directory, absolute);
      if (excluded.has(path)) continue;
      if (entry.isSymbolicLink()) result[path] = { symlink: readlinkSync(absolute) };
      else if (entry.isDirectory()) visit(absolute);
      else result[path] = digest(readFileSync(absolute));
    }
  };
  visit(directory);
  return result;
};
const oraclePath = "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du";
const oracleHash = "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b";
assert.equal(digest(readFileSync(join(root, oraclePath))), oracleHash);
const distBefore = inventory(join(root, "dist"));
const indexBefore = git("ls-files", "--stage", "-z");
const results = [];
let failed = false;
try {
  const archive = git("archive", "--format=tar", candidate, "--", ...paths);
  execFileSync("tar", ["-xf", "-", "-C", runtime], { input: archive });
  for (const [path, pin] of Object.entries(seal.productPins)) assert.equal(digest(readFileSync(join(runtime, path))), pin.sha256, path);
  symlinkSync(join(root, "node_modules"), join(runtime, "node_modules"), "dir");
  mkdirSync(dirname(join(runtime, oraclePath)), { recursive: true });
  symlinkSync(join(root, oraclePath), join(runtime, oraclePath));
  mkdirSync(join(runtime, "tests/fs/overlay/allocation-evidence"), { recursive: true });
  const excluded = new Set(["node_modules", ".build"]);
  const before = inventory(runtime, excluded);
  save("manifest-before.json", before);
  save("driver.mjs.txt", readFileSync(fileURLToPath(import.meta.url), "utf8"));
  save("overlay-driver.mjs.txt", overlayDriver);
  save("provenance.json", {
    startedAt: new Date().toISOString(), candidate, candidateTree: git("rev-parse", `${candidate}^{tree}`).toString().trim(),
    liveHead: git("rev-parse", "HEAD").toString().trim(), liveStatus: git("status", "--short").toString(),
    archiveSha256: digest(archive), archiveBytes: archive.length, paths, du, strict, focused,
    overlaySelectionSource: { path: overlayDriverPath, sha256: digest(committed(overlayDriverPath)) },
    overlayInputDiscovery: { path: overlayManifestPath, sha256: digest(committed(overlayManifestPath)) },
    productPins: seal.productPins, runtime, node: process.version, platform: process.platform, arch: process.arch, uv: process.versions.uv,
    installedTooling: Object.fromEntries(["node_modules/typescript/package.json", "node_modules/typescript/lib/_tsc.js", "node_modules/tsx/package.json", "node_modules/tsx/dist/loader.mjs"].map(path => [path, digest(readFileSync(join(root, path)))])),
    native: { path: oraclePath, sha256: oracleHash, version: execFileSync(join(root, oraclePath), ["--version"], { encoding: "utf8", timeout: 10000 }).split("\n")[0] },
    scope: "Committed-input archive only; no live product overlay. Existing canonical native cases, GNU9.7/Darwin only. Installed tooling and read-only native binary are external prerequisites. No public package import claim.",
  });
  const flags = ["--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node"];
  const commands = [
    ["du", ["--import", "tsx", "--test", "--test-concurrency=1", ...du]],
    ["overlay-strict", ["--import", "tsx", "--test", "--test-concurrency=1", ...strict]],
    ["overlay-focused", ["--import", "tsx", "--test", "--test-concurrency=1", ...focused]],
    ["du-types", ["node_modules/typescript/bin/tsc", "-p", "tests/commands/du/tsconfig.json"]],
    ["functional-types", ["node_modules/typescript/bin/tsc", "-p", "tests/commands/du/functional-v1/tsconfig.json"]],
    ["overlay-types", ["node_modules/typescript/bin/tsc", ...flags, ...strict, ...focused]],
    ["isolated-build", ["node_modules/typescript/bin/tsc", "-p", "tests/commands/du/functional-v1/tsconfig.build.json", "--outDir", join(runtime, ".build")]],
    ["built-boundary", ["tests/commands/du/functional-v1/verify-built.mjs", join(runtime, ".build")]],
  ];
  for (const [name, args] of commands) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, args, { cwd: runtime, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000,
      env: { ...process.env, TMPDIR: runtime, TSX_DISABLE_CACHE: "1", NODE_DISABLE_COMPILE_CACHE: "1" } });
    save(`${name}.stdout.txt`, result.stdout ?? ""); save(`${name}.stderr.txt`, result.stderr ?? "");
    const counts = Object.fromEntries([...(result.stdout ?? "").matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const record = { name, args, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, counts };
    results.push(record); save(`${name}.json`, record);
    console.log(JSON.stringify({ name, status: result.status, counts }));
    if (result.status !== 0 || counts.skipped > 0 || counts.cancelled > 0) failed = true;
  }
  const after = inventory(runtime, excluded);
  const distAfter = inventory(join(root, "dist"));
  const indexAfter = git("ls-files", "--stage", "-z");
  save("manifest-after.json", after);
  save("build-manifest.json", inventory(join(runtime, ".build")));
  save("closure.json", {
    candidate, results, finishedAt: new Date().toISOString(),
    changed: Object.keys(before).filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path])),
    added: Object.keys(after).filter(path => !Object.hasOwn(before, path)),
    archiveSha256After: digest(git("archive", "--format=tar", candidate, "--", ...paths)),
    originalInputSha256: digest(JSON.stringify(before)), finalInputSha256: digest(JSON.stringify(after)),
    nativeSha256After: digest(readFileSync(join(root, oraclePath))),
    indexBeforeSha256: digest(indexBefore), indexAfterSha256: digest(indexAfter), indexPreserved: indexBefore.equals(indexAfter),
    sharedDistBeforeSha256: digest(JSON.stringify(distBefore)), sharedDistAfterSha256: digest(JSON.stringify(distAfter)), sharedDistPreserved: JSON.stringify(distBefore) === JSON.stringify(distAfter),
    inspectionScope: "All runtime file paths including new entries and symlink targets; excludes explicitly installed node_modules link and separately hashed .build output. Empty directories, external tooling contents, and hostile concurrent mutation are not append-proof claims.",
  });
  assert.deepEqual(after, before);
  assert.equal(digest(git("archive", "--format=tar", candidate, "--", ...paths)), digest(archive));
  assert.equal(digest(readFileSync(join(root, oraclePath))), oracleHash);
  assert.deepEqual(distAfter, distBefore);
} finally {
  rmSync(runtime, { recursive: true, force: true });
  save("cleanup.json", { removedOwnedRuntime: runtime, absent: !existsSync(runtime), finishedAt: new Date().toISOString() });
}
console.log(relative(root, output));
if (failed) process.exitCode = 1;
