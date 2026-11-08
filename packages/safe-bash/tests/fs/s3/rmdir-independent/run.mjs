import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../../..");
const sourceRevision = "04879692a66d88eee129b8ffd6e7ca93c7a9476a";
const inputRevision = "df780f6ddb6292283114461ff4f9ebacfb269205";
const matrixRevision = "debb29ead94ae387f359d9d04b333ee4380f88d6";
const serviceEnabled = process.argv.includes("--service");
const output = mkdtempSync(join(owned, "evidence-"));
const scratch = mkdtempSync(join(owned, ".isolated-"));
const snapshot = join(scratch, "source");
const consumer = join(scratch, "consumer");
const packageRoot = join(consumer, "node_modules/virtual-bash");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const list = (revision, ...paths) => git("ls-tree", "-r", "--name-only", revision, "--", ...paths).toString().trim().split("\n").filter(Boolean);
const contents = (revision, path) => git("show", `${revision}:${path}`);
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? files(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []);
const manifest = [];
const commands = [];
const originalPaths = ["tests/fs/s3/rmdir-real-service", "tests/integration/adapter-tools/remote-rmdir"];
const sealedOriginals = originalPaths.flatMap(path => files(join(root, path))).sort().map(path => ({ path: relative(root, path), sha256: hash(readFileSync(path)) }));
const checkFrozen = () => manifest.forEach(entry => assert.equal(hash(readFileSync(join(snapshot, entry.path))), entry.sha256, entry.path));
let success = false;
const execute = (name, executable, args, cwd = snapshot, extra = {}) => {
  checkFrozen();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, TMPDIR: scratch, TSX_DISABLE_CACHE: "1", npm_config_cache: join(scratch, "npm-cache"), ...extra } });
  writeFileSync(join(output, name + ".stdout"), result.stdout ?? "");
  writeFileSync(join(output, name + ".stderr"), result.stderr ?? "");
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key =>
    [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(result.stdout ?? "")?.[1] ?? -1)]));
  const receipt = { name, executable, args, cwd, startedAt, elapsedMs: performance.now() - started, status: result.status,
    signal: result.signal, error: result.error?.message, counts, failures: [...(result.stdout ?? "").matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]) };
  commands.push(receipt);
  save("commands.json", commands);
  checkFrozen();
  console.log(name, result.status, JSON.stringify(counts));
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
};
const assertSuite = (name, paths, total, failures = 0) => {
  const result = execute(name, process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", ...paths]);
  assert.equal(result.status, failures ? 1 : 0);
  assert.deepEqual(commands.at(-1).counts, { tests: total, pass: total - failures, fail: failures, cancelled: 0, skipped: 0, todo: 0 });
};
console.log(output);
try {
  mkdirSync(snapshot);
  mkdirSync(packageRoot, { recursive: true });
  const sourcePaths = [...list(sourceRevision, "src"), "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
  const topTests = list(inputRevision, "tests/fs/s3", "tests/fs/mount", "tests/fs/overlay", "tests/fs/readonly")
    .filter(path => /^tests\/fs\/(s3|mount|overlay|readonly)\/[^/]+\.ts$/.test(path));
  const httpInputs = list(inputRevision, "tests/fs/s3/http/unit").filter(path => path.endsWith(".ts"));
  const serviceInputs = list(inputRevision, "tests/fs/s3/http/interop").filter(path => /^tests\/fs\/s3\/http\/interop\/[^/]+\.(mjs|json)$/.test(path));
  const profile = "tests/fs/s3/rmdir-real-service/snapshot-profile/rmdir-profile.test.ts";
  const integration = "tests/integration/adapter-tools/remote-rmdir/combined-shell/snapshot.test.ts";
  const serviceChecks = "tests/fs/s3/rmdir-real-service/snapshot-profile/service-checks.mjs";
  const inputPaths = [...new Set([...topTests, ...httpInputs, ...serviceInputs, profile, integration, serviceChecks,
    "tests/fs/webdav/property-fixture.ts", "tests/fs/real/helpers.ts"])];
  const matrixPaths = ["tests/integration/adapter-tools/fixtures.ts", "tests/integration/adapter-tools/matrix.test.ts",
    "tests/integration/adapter-tools/preflight-review/preflight.ts", "tests/integration/adapter-tools/preflight-review/preflight.test.ts", "tests/fs/webdav/mock.ts"];
  for (const [name, revision, paths] of [["source", sourceRevision, sourcePaths], ["tests", inputRevision, inputPaths], ["matrix", matrixRevision, matrixPaths]]) {
    const archive = git("archive", "--format=tar.gz", revision, "--", ...paths);
    const archivePath = join(output, name + ".tar.gz");
    writeFileSync(archivePath, archive);
    assert.equal(spawnSync("tar", ["-xzf", archivePath, "-C", snapshot]).status, 0);
    for (const path of paths) manifest.push({ path, revision, sha256: hash(contents(revision, path)) });
  }
  checkFrozen();
  for (const [revision, path] of [["5660248b1ff89572a6164d0b0c7bd22d03630d9b", "src/fs/s3/filesystem.ts"],
    ["ba200fec275dbda8c30cc368252cd61b6d42527c", "src/contracts/filesystem.ts"],
    ["ba200fec275dbda8c30cc368252cd61b6d42527c", "src/contracts/filesystem.md"]]) {
    assert.equal(hash(contents(revision, path)), hash(readFileSync(join(snapshot, path))));
  }
  for (const path of matrixPaths) assert.deepEqual(contents(sourceRevision, path), contents(matrixRevision, path));
  symlinkSync(join(root, "node_modules"), join(snapshot, "node_modules"));
  save("freeze.json", { sourceRevision, inputRevision, matrixRevision, sourceTree: git("rev-parse", `${sourceRevision}:src`).toString().trim(),
    liveHead: git("rev-parse", "HEAD").toString().trim(), liveStatus: git("status", "--short").toString(), node: process.version,
    nodeSha256: hash(readFileSync(process.execPath)), platform: process.platform + "-" + process.arch, manifest,
    toolchain: ["typescript", "tsx", "@types/node"].map(name => ({ name, package: JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"))) })),
    serviceEnabled, startedAt: new Date().toISOString(), scope: "independent leaf; frozen committed source, no live overlay" });
  save("original-seal.json", sealedOriginals);
  for (const path of files(owned).filter(path => dirname(path) === owned && /\.(mjs|mts)$/.test(path))) {
    copyFileSync(path, join(output, "input-" + relative(owned, path) + ".txt"));
  }
  assert.equal(execute("build", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]).status, 0);
  const s3Tests = topTests.filter(path => /^tests\/fs\/s3\/[^/]+\.test\.ts$/.test(path));
  const httpTests = httpInputs.filter(path => path.endsWith(".test.ts"));
  const wrappers = ["mount", "overlay", "readonly"].map(name => `tests/fs/${name}/snapshot-rmdir.test.ts`);
  const aliases = ["tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"];
  assertSuite("original-s3-http382", [...s3Tests, profile, ...httpTests], 382);
  assertSuite("original-wrappers16", wrappers, 16);
  assertSuite("original-alias49", aliases, 49);
  assertSuite("original-integrations6", [integration], 6);
  assertSuite("original-preflight30", [matrixPaths[3]], 30);
  assertSuite("original-matrix79", [matrixPaths[1]], 79, 1);
  assert.deepEqual(commands.at(-1).failures, ["webdav: create, copy, append, inspect and remove files"]);
  const typeArgs = ["--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict",
    "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node"];
  assert.equal(execute("scoped-types", process.execPath, ["node_modules/typescript/bin/tsc", ...typeArgs, ...s3Tests, profile, ...httpTests, ...wrappers, ...aliases, integration, ...matrixPaths.filter(path => path.endsWith(".ts"))]).status, 0);
  const packed = execute("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", output]);
  assert.equal(packed.status, 0);
  const tarball = join(output, JSON.parse(packed.stdout)[0].filename);
  assert.equal(execute("unpack", "tar", ["-xzf", tarball, "--strip-components=1", "-C", packageRoot]).status, 0);
  const closure = files(join(snapshot, "dist")).sort().map(path => {
    const local = relative(snapshot, path);
    assert.deepEqual(readFileSync(path), readFileSync(join(packageRoot, local)));
    return { path: local, bytes: readFileSync(path).length, sha256: hash(readFileSync(path)) };
  });
  assert.deepEqual(files(join(packageRoot, "dist")).map(path => relative(packageRoot, path)).sort(), closure.map(entry => entry.path).sort());
  save("emitted-closure.json", { sourceRevision, tarball: relative(output, tarball), tarballSha256: hash(readFileSync(tarball)),
    runtimeDependencies: JSON.parse(readFileSync(join(packageRoot, "package.json"))).dependencies ?? {}, files: closure });
  const before = execute("resolution-before-boundary", process.execPath, ["--input-type=module", "--eval", 'console.log(import.meta.resolve("virtual-bash"))'], consumer);
  assert.equal(before.status, 0);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "independent-rmdir-consumer", private: true, type: "module" }) + "\n");
  symlinkSync(join(root, "node_modules/@types"), join(consumer, "node_modules/@types"));
  for (const name of ["probe.mjs", "independent.test.mjs", "public-consumer.mts", "service-run.mjs"]) copyFileSync(join(owned, name), join(consumer, name));
  copyFileSync(join(snapshot, serviceChecks), join(consumer, "original-service-checks.mjs"));
  const auditEnv = { INDEPENDENT_PACKAGE_URL: pathToFileURL(packageRoot + "/").href,
    INDEPENDENT_LOAD_LOG: join(output, "probe-loads.jsonl"), INDEPENDENT_PROBE: join(output, "public-resolution.json") };
  const loader = ["--loader", pathToFileURL(join(owned, "load-audit.mjs")).href];
  assert.equal(execute("public-probe", process.execPath, [...loader, "probe.mjs"], consumer, auditEnv).status, 0);
  assert.equal(execute("public-types", process.execPath, [join(root, "node_modules/typescript/bin/tsc"), ...typeArgs, "public-consumer.mts"], consumer).status, 0);
  const independent = execute("independent", process.execPath, [...loader, "--unhandled-rejections=strict", "--test", "--test-reporter=tap", "independent.test.mjs"], consumer,
    { ...auditEnv, INDEPENDENT_LOAD_LOG: join(output, "independent-loads.jsonl") });
  assert.equal(independent.status, 0);
  if (serviceEnabled) {
    const tooling = join(scratch, "tooling");
    mkdirSync(tooling);
    const relocation = [];
    for (const name of ["service.mjs", "prepare.mjs", "reference-signature.mjs", "service.lock.json"]) {
      const original = readFileSync(join(snapshot, "tests/fs/s3/http/interop", name), "utf8");
      let text = original;
      if (name === "service.mjs") text = text.replace('"/tmp/safe-bash-s3-service-"', JSON.stringify(join(output, "service-")));
      if (name === "prepare.mjs") text = text.replace('"/tmp/safe-bash-minio-download-"', JSON.stringify(join(scratch, "download-")));
      writeFileSync(join(tooling, name), text);
      relocation.push({ name, originalSha256: hash(original), relocatedSha256: hash(text), text });
    }
    save("service-relocation.json", relocation);
    const download = execute("single-pinned-download", process.execPath, [join(tooling, "prepare.mjs")]);
    assert.equal(download.status, 0);
    const binary = download.stdout.trim().split("\n").at(-1);
    assert.ok(binary.startsWith(scratch + "/download-"));
    copyFileSync(join(dirname(binary), "download.json"), join(output, "download.json"));
    copyFileSync(join(dirname(binary), "official.sha256sum"), join(output, "official.sha256sum"));
    const serviceResult = execute("service20-and-wire", process.execPath, [...loader, "--unhandled-rejections=strict", "service-run.mjs", binary, tooling, output], consumer,
      { ...auditEnv, INDEPENDENT_LOAD_LOG: join(output, "service-loads.jsonl") });
    assert.equal(serviceResult.status, 0);
  }
  for (const name of ["probe", "independent", ...(serviceEnabled ? ["service"] : [])]) {
    const loads = readFileSync(join(output, name + "-loads.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    for (const entry of loads) {
      const local = relative(packageRoot, fileURLToPath(entry.url));
      assert.equal(closure.find(file => file.path === local)?.sha256, entry.sha256, entry.url);
    }
    save(name + "-closure-check.json", { actualLoads: loads.length, uniqueModules: new Set(loads.map(entry => entry.url)).size, allMatchPackedAndBuilt: true });
  }
  success = true;
} finally {
  const changedOriginals = sealedOriginals.filter(entry => !existsSync(join(root, entry.path)) || hash(readFileSync(join(root, entry.path))) !== entry.sha256);
  const changedFrozen = manifest.filter(entry => !existsSync(join(snapshot, entry.path)) || hash(readFileSync(join(snapshot, entry.path))) !== entry.sha256);
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, removed: !existsSync(scratch), success, changedOriginals, changedFrozen, finishedAt: new Date().toISOString(),
    serviceShutdowns: files(output).filter(path => path.endsWith("/shutdown.json")).map(path => JSON.parse(readFileSync(path))) });
  assert.deepEqual(changedOriginals, []);
  assert.deepEqual(changedFrozen, []);
}
