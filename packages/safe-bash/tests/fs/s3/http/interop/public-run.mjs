import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lock, save, sha256 } from "./service.mjs";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const mode = process.argv[2] ?? "--build-only";
assert.ok(!mode.startsWith("--") || mode === "--build-only" || mode === "--download");
const output = mkdtempSync("/tmp/safe-bash-s3-public-interop-");
const archive = join(output, "archive");
const author = "tests/fs/s3/http/author";
const interop = "tests/fs/s3/http/interop";
const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const walk = directory => readdirSync(join(repository, directory), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const inputs = [...walk("src").filter(name => name.endsWith(".ts")), "package.json", "tsconfig.json", "tsconfig.build.json",
  `${author}/public-consumer.mts`, `${author}/build-public-consumer.mjs`, `${author}/PUBLIC-CONSUMER.md`,
  ...readdirSync(join(repository, interop)).filter(name => /\.(mjs|json)$/.test(name)).map(name => `${interop}/${name}`)].sort();
const manifest = () => inputs.map(path => ({ path, sha256: sha256(readFileSync(join(repository, path))) }));
const before = manifest();
save(join(output, "provenance.json"), { head: git("rev-parse", "HEAD").trim(), node: process.version, mode,
  status: git("status", "--short"), inputHashes: before,
  snapshot: "Actual current source, author consumer/runner and real manifests copied byte-for-byte; no export changes" });
for (const path of inputs) {
  const destination = join(archive, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(repository, path), destination);
  assert.equal(sha256(readFileSync(destination)), before.find(entry => entry.path === path).sha256);
}
symlinkSync(join(repository, "node_modules"), join(archive, "node_modules"));
console.log(output);
const commands = [];
const execute = (name, args) => {
  const result = spawnSync(process.execPath, args, { cwd: archive, encoding: "utf8", timeout: 240000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_DIR: git("rev-parse", "--absolute-git-dir").trim() } });
  writeFileSync(join(output, `${name}.stdout`), result.stdout ?? "");
  writeFileSync(join(output, `${name}.stderr`), result.stderr ?? "");
  commands.push({ name, argv: [process.execPath, ...args], cwd: archive, status: result.status,
    signal: result.signal, error: result.error?.message ?? null });
  save(join(output, "commands.json"), commands);
  console.log(name, result.status);
  return result;
};
let downloadedBinary;
let serviceStarted = false;
let serviceOutput;
try {
  const build = execute("public-build", [`${author}/build-public-consumer.mjs`, "interop"]);
  const buildRecordPath = join(archive, author, "public-build-interop.json");
  if (existsSync(buildRecordPath)) copyFileSync(buildRecordPath, join(output, "public-build.json"));
  assert.equal(build.status, 0, "Actual public-package build failed; service and download were not started. See public-build.stdout/stderr.");
  const record = JSON.parse(readFileSync(buildRecordPath));
  assert.deepEqual(record.results.map(result => result.status), [0, 0, 0]);
  assert.deepEqual(record.changedDuringBuild, []);
  const isolated = join(archive, record.isolated);
  assert.deepEqual(readFileSync(join(isolated, "package.json")), readFileSync(join(archive, "package.json")));
  const compiled = await import(pathToFileURL(join(archive, record.compiledExample)).href);
  assert.equal(typeof compiled.runPublicS3Example, "function");
  if (mode === "--build-only") {
    save(join(output, "result.json"), { classification: "Strict actual public-package build/import only; service not run", buildPassed: true, workflowsRun: 0 });
  } else {
    let binary = resolve(mode);
    if (mode === "--download") {
      const download = execute("download", [`${interop}/prepare.mjs`]);
      assert.equal(download.status, 0, download.stderr);
      binary = download.stdout.trim().split("\n").at(-1);
      assert.match(binary, /^\/tmp\/safe-bash-minio-download-[^/]+\/minio$/);
      downloadedBinary = binary;
      for (const name of ["official.sha256sum", "download.json"]) copyFileSync(join(dirname(binary), name), join(output, name));
    }
    assert.equal(sha256(readFileSync(binary)), lock.sha256);
    const { withService } = await import(pathToFileURL(join(archive, interop, "service.mjs")).href);
    await withService(binary, async ({ output: directory, endpoint, credentials, bucket, wire }) => {
      serviceStarted = true;
      serviceOutput = directory;
      save(join(output, "service.json"), { directory });
      const prefix = `public-${randomUUID()}`;
      const options = { endpoint, region: "us-east-1", credentials, bucket, prefix,
        verifiedConditionalPut: true, allowInsecureHttp: true, listUrlEncoding: "form" };
      save(join(directory, "public-options.json"), options);
      const result = await compiled.runPublicS3Example({ ...options, signal: AbortSignal.timeout(60000) });
      save(join(directory, "public-result.json"), result);
      assert.equal(result.checks.length, 9);
      assert.equal(result.bucket, bucket); assert.equal(result.prefix, prefix);
      assert.deepEqual(result.move, { supported: false, code: "ENOTSUP", sourcePreserved: true, targetPreserved: true });
      const expected = new Map([
        ["work/source", [66, 0, 67, 255]], ["work/copy", [0, 255, 128, 10, 65]],
        ["work/existing", [0, 255, 128, 10, 65]], ["work/move-target", [7, 8, 9]],
        ["work/雪 space +%", [0, 255, 128, 10, 65]], ["other/target", [66, 0, 67, 255]],
      ]);
      for (const [key, bytes] of expected) {
        const path = `/${bucket}/${[prefix, ...key.split("/")].map(encodeURIComponent).join("/")}`;
        const response = await wire("GET", path);
        assert.equal(response.status, 200); assert.deepEqual([...response.body], bytes);
      }
      save(join(output, "result.json"), { classification: "One actual-service workflow with nine named author checks, not nine independent tests",
        buildPassed: true, workflowsRun: 1, workflowsPassed: 1, namedChecks: result.checks,
        independentFinalObjectReads: expected.size, publicResult: result });
    });
  }
} catch (error) {
  save(join(output, "failure.json"), { name: error.name, message: error.message, stack: error.stack,
    serviceStarted, serviceOutput: serviceOutput ?? null });
  process.exitCode = 1;
} finally {
  if (downloadedBinary) {
    assert.equal(sha256(readFileSync(downloadedBinary)), lock.sha256);
    rmSync(downloadedBinary);
  }
  const after = manifest();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  save(join(output, "after.json"), { inputHashes: after, unchanged, serviceStarted, serviceOutput: serviceOutput ?? null,
    downloadedBinaryRemoved: downloadedBinary ? !existsSync(downloadedBinary) : null });
  const snapshotUnchanged = before.every(entry => sha256(readFileSync(join(archive, entry.path))) === entry.sha256);
  assert.ok(snapshotUnchanged, "isolated source or manifest changed during validation");
  console.log(JSON.stringify({ output, serviceStarted, sourceUnchanged: unchanged, snapshotUnchanged, status: process.exitCode ?? 0 }));
}
