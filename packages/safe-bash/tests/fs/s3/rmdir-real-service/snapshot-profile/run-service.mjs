import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../..");
const mode = process.argv[2];
assert.ok(mode === "--download" || (mode && !mode.startsWith("--")), "supply --download or an existing pinned binary");
const output = mkdtempSync(join(owned, "evidence-"));
const scratch = mkdtempSync(join(owned, ".scratch-"));
const archive = join(scratch, "source");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const hash = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const head = git("rev-parse", "HEAD").trim();
const tracked = git("ls-tree", "-r", "--name-only", head).trim().split("\n");
const s3Tests = ["tests/fs/s3/rmdir.test.ts", "tests/fs/s3/rmdir-real-service/snapshot-profile/rmdir-profile.test.ts"];
const httpTests = [];
const wrapperTests = [];
const aliasTests = [];
const inputs = [...new Set([...tracked.filter(path => path.startsWith("src/")), "package.json", "tsconfig.json", "tsconfig.build.json",
  ...s3Tests, ...httpTests, ...wrapperTests, ...aliasTests, "tests/fs/s3/http/unit/helpers.ts", "tests/fs/overlay/helpers.ts",
  "tests/fs/webdav/mock.ts", ...tracked.filter(path => /^tests\/fs\/s3\/http\/interop\/[^/]+\.(mjs|json)$/.test(path))])].sort();
const commands = [];
const execute = (name, executable, args, cwd = archive) => {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 240000, maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env, TMPDIR: scratch, npm_config_cache: join(scratch, "npm-cache"), TSX_DISABLE_CACHE: "1" } });
  writeFileSync(join(output, `${name}.stdout`), result.stdout ?? "");
  writeFileSync(join(output, `${name}.stderr`), result.stderr ?? "");
  commands.push({ name, executable, args, status: result.status, signal: result.signal, error: result.error?.message ?? null });
  save("commands.json", commands);
  console.log(name, result.status);
  return result;
};
let serviceOutput;
let success = false;
const manifest = [];
console.log(output);
try {
  assert.equal(git("diff", head, "--", "src/fs/s3"), "", "owned S3 source must match frozen HEAD");
  mkdirSync(archive);
  for (const path of inputs) {
    const content = execFileSync("git", ["show", `${head}:${path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
    if (path.startsWith("src/fs/s3/") || path.startsWith("tests/fs/s3/")) assert.equal(hash(readFileSync(join(repository, path))), hash(content), `owned input differs: ${path}`);
    const destination = join(archive, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    manifest.push({ path, sha256: hash(content) });
  }
  symlinkSync(join(repository, "node_modules"), join(archive, "node_modules"));
  save("provenance.json", { head, status: git("status", "--short"), node: process.version, platform: `${process.platform}-${process.arch}`,
    authorOnly: true, sourceDirty: false, inputs: manifest, snapshot: "committed HEAD only; unrelated uncommitted source not overlaid", sourceCheckpoint: "5660248b1ff89572a6164d0b0c7bd22d03630d9b", runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    checksSha256: hash(readFileSync(join(owned, "service-checks.mjs"))), originalMatrixBaseline: "77/79; not rerun or inferred green" });
  save("author-inputs.json", Object.fromEntries(["run-service.mjs", "service-checks.mjs", "README.md"].map(name => [name, readFileSync(join(owned, name), "utf8")])));
  assert.equal(execute("build", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]).status, 0);
  for (const [name, tests] of [["s3-rmdir-profile", s3Tests]]) {
    assert.equal(execute(name, process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...tests]).status, 0, name);
  }
  assert.equal(execute("scoped-types", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023",
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes",
    "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", ...s3Tests, ...httpTests, ...wrapperTests, ...aliasTests]).status, 0);
  const packed = execute("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch]);
  assert.equal(packed.status, 0);
  const tarball = join(scratch, JSON.parse(packed.stdout)[0].filename);
  const consumer = join(scratch, "consumer");
  const packageRoot = join(consumer, "node_modules", "virtual-bash");
  mkdirSync(packageRoot, { recursive: true });
  assert.equal(execute("unpack", "tar", ["-xzf", tarball, "--strip-components=1", "-C", packageRoot]).status, 0);
  assert.deepEqual(readFileSync(join(packageRoot, "package.json")), readFileSync(join(archive, "package.json")));
  save("package.json", { tarballSha256: hash(readFileSync(tarball)), manifestSha256: hash(readFileSync(join(packageRoot, "package.json"))),
    runtimeDependencies: JSON.parse(readFileSync(join(packageRoot, "package.json"))).dependencies ?? {} });
  copyFileSync(join(owned, "service-checks.mjs"), join(consumer, "service-checks.mjs"));
  const beforeIsolation = execute("public-resolution-before-isolation", process.execPath,
    ["--input-type=module", "--eval", 'console.log(import.meta.resolve("virtual-bash"))'], consumer);
  assert.equal(beforeIsolation.status, 0);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "safe-bash-s3-snapshot-consumer", private: true, type: "module" }) + "\n");
  const checks = await import(pathToFileURL(join(consumer, "service-checks.mjs")).href);
  const expectedResolution = { root: pathToFileURL(join(packageRoot, "dist/index.js")).href,
    s3: pathToFileURL(join(packageRoot, "dist/fs/s3/index.js")).href, http: pathToFileURL(join(packageRoot, "dist/fs/s3/http/index.js")).href };
  assert.deepEqual(checks.packageResolution, expectedResolution);
  const packedS3 = hash(readFileSync(join(packageRoot, "dist/fs/s3/filesystem.js")));
  assert.equal(packedS3, hash(readFileSync(join(archive, "dist/fs/s3/filesystem.js"))));
  save("public-resolution.json", { beforeIsolation: beforeIsolation.stdout.trim(), actual: checks.packageResolution,
    expected: expectedResolution, packedS3Sha256: packedS3, consumerPackage: JSON.parse(readFileSync(join(consumer, "package.json"))) });
  const tooling = join(scratch, "tooling");
  mkdirSync(tooling);
  const adaptations = [];
  for (const name of ["service.mjs", "prepare.mjs", "reference-signature.mjs", "service.lock.json"]) {
    const original = readFileSync(join(archive, "tests/fs/s3/http/interop", name), "utf8");
    let relocated = original;
    if (name === "service.mjs") relocated = original.replace('"/tmp/safe-bash-s3-service-"', JSON.stringify(join(output, "service-")));
    if (name === "prepare.mjs") relocated = original.replace('"/tmp/safe-bash-minio-download-"', JSON.stringify(join(scratch, "download-")));
    if (name === "service.mjs" || name === "prepare.mjs") assert.notEqual(relocated, original);
    writeFileSync(join(tooling, name), relocated);
    adaptations.push({ name, originalSha256: hash(original), relocatedSha256: hash(relocated), relocated: original !== relocated });
  }
  save("harness-relocation.json", adaptations);
  const harness = await import(pathToFileURL(join(tooling, "service.mjs")).href);
  let binary = resolve(mode);
  if (mode === "--download") {
    const download = execute("download", process.execPath, [join(tooling, "prepare.mjs")]);
    assert.equal(download.status, 0, download.stderr);
    binary = download.stdout.trim().split("\n").at(-1);
    assert.ok(binary.startsWith(scratch + "/download-"));
    copyFileSync(join(dirname(binary), "download.json"), join(output, "download.json"));
    copyFileSync(join(dirname(binary), "official.sha256sum"), join(output, "official.sha256sum"));
  }
  serviceOutput = await harness.withService(binary, async service => {
    serviceOutput = service.output;
    await checks.runChecks(service);
  });
  success = true;
} finally {
  const changedLiveInputs = manifest.filter(entry => !existsSync(join(repository, entry.path)) || hash(readFileSync(join(repository, entry.path))) !== entry.sha256);
  const frozenChanged = manifest.filter(entry => hash(readFileSync(join(archive, entry.path))) !== entry.sha256);
  save("final-audit.json", { headBefore: head, headAfter: git("rev-parse", "HEAD").trim(), liveVersusFrozenInputs: changedLiveInputs, frozenChanged,
    sourcePatch: git("diff", head, "--", "src/fs/s3"), success, serviceOutput });
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, scratchRemoved: !existsSync(scratch), ownedDownloadRemoved: mode === "--download",
    serviceOutput, serviceShutdown: serviceOutput && existsSync(join(serviceOutput, "shutdown.json")) ? JSON.parse(readFileSync(join(serviceOutput, "shutdown.json"))) : null });
  assert.deepEqual(frozenChanged, []);
}
