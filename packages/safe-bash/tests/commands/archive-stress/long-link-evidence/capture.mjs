import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const phase = process.argv[2];
assert.ok(phase === "baseline" || phase === "fixed");
assert.equal(process.cwd(), root, "run from the repository root");
for (const suffix of ["-regression.mjs", "-format.ts.txt", "-input.test.ts.txt", ".json", ".tap"]) {
  await assert.rejects(lstat(join(directory, `${phase}${suffix}`)), { code: "ENOENT" }, "refuse to overwrite frozen evidence");
}
const source = "src/commands/archive/format.ts";
const regression = "tests/commands/archive-stress/long-link-regression.test.ts";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const execute = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  return { binary, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
};
const git = (...args) => {
  const result = execute("git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
};
const lockBytes = await readFile(join(root, "package-lock.json"));
const lock = JSON.parse(lockBytes);
const packages = ["esbuild", `@esbuild/${process.platform}-${process.arch}`];
const compiler = [];
for (const name of packages) {
  const packagePath = `node_modules/${name}/package.json`;
  const installed = JSON.parse(await readFile(join(root, packagePath)));
  const locked = lock.packages[`node_modules/${name}`];
  assert.equal(installed.version, locked.version);
  const implementation = `node_modules/${name}/${name === "esbuild" ? "lib/main.js" : "bin/esbuild"}`;
  compiler.push({ name, installedVersion: installed.version, lockedVersion: locked.version, lockIntegrity: locked.integrity,
    packageSha256: hash(await readFile(join(root, packagePath))), implementation, implementationSha256: hash(await readFile(join(root, implementation))) });
}
const before = { time: new Date().toISOString(), head: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain=v1", "--untracked-files=all") };
const inputSource = await readFile(join(root, source), "utf8");
const inputRegression = await readFile(join(root, regression), "utf8");
const output = await build({
  absWorkingDir: root, entryPoints: [regression], outfile: join(directory, `${phase}-regression.mjs`),
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
  metafile: true, legalComments: "none", sourcemap: false, logLevel: "silent",
});
assert.equal(output.outputFiles.length, 1);
const bundled = output.outputFiles[0].text;
const closure = [];
for (const path of Object.keys(output.metafile.inputs).sort()) {
  assert.ok(path === regression || path === source || path === "src/commands/archive/internal.ts" || /^src\/contracts\/[^/]+\.ts$/u.test(path), `unexpected source: ${path}`);
  const stat = await lstat(join(root, path));
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `not a regular input: ${path}`);
  closure.push({ path, sha256: hash(await readFile(join(root, path))) });
}
const runtimeImports = Object.values(output.metafile.outputs).flatMap(record => record.imports);
assert.ok(runtimeImports.every(record => record.external && record.path.startsWith("node:")), "frozen runtime must contain only Node builtin imports");
assert.equal(await readFile(join(root, source), "utf8"), inputSource);
assert.equal(await readFile(join(root, regression), "utf8"), inputRegression);
const addFiles = files => {
  const patch = "*** Begin Patch\n" + files.map(([path, text]) => `*** Add File: ${relative(root, path)}\n${text.replace(/\n$/u, "").split("\n").map(line => `+${line}`).join("\n")}\n`).join("") + "*** End Patch\n";
  const result = execute("apply_patch", [], { input: patch });
  assert.equal(result.status, 0, result.stderr);
};
addFiles([
  [join(directory, `${phase}-regression.mjs`), bundled],
  [join(directory, `${phase}-format.ts.txt`), inputSource],
  [join(directory, `${phase}-input.test.ts.txt`), inputRegression],
]);
const bundlePath = join(directory, `${phase}-regression.mjs`);
assert.ok((await lstat(bundlePath)).isFile());
assert.equal(hash(await readFile(bundlePath)), hash(bundled));
const result = execute(process.execPath, ["--test", relative(root, bundlePath)], { env: { ...process.env, ARCHIVE_LONG_LINK_NATIVE: "1" } });
const observations = [];
for (const line of result.stdout.split("\n")) {
  if (line.startsWith("# {\"kind\":")) observations.push(JSON.parse(line.slice(2)));
}
assert.equal(observations.filter(record => record.kind === "native").length, 2);
assert.equal(observations.filter(record => record.kind === "raw-archive").length, 1);
for (const record of closure) assert.equal(hash(await readFile(join(root, record.path))), record.sha256, `source moved: ${record.path}`);
assert.equal(hash(await readFile(bundlePath)), hash(bundled));
const after = { time: new Date().toISOString(), head: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain=v1", "--untracked-files=all") };
const report = {
  phase, scope: "Static bundled direct encodeEntry regression; no Shell, filesystem adapter, registry, or create/gzip command runtime. Gzip wrapper uses Node zlib.",
  runtime: { node: process.version, executable: process.execPath, executableSha256: hash(await readFile(process.execPath)), platform: process.platform, arch: process.arch, externalImports: runtimeImports },
  before, after, closure, sourceSha256: hash(inputSource), regressionSha256: hash(inputRegression), bundleSha256: hash(bundled),
  packageLockSha256: hash(lockBytes), compiler,
  dependencyQualification: "Frozen runtime is one regular self-contained ESM file plus Node builtins; no installed JS runtime dependencies or live source aliases. Generation-only esbuild versions match the lock and exact used compiler/binary bytes are hashed; lock integrity is recorded, not a new registry-content attestation.",
  metafile: output.metafile, observations,
  command: { ...result, stdout: undefined, stderr: undefined },
};
addFiles([
  [join(directory, `${phase}.json`), `${JSON.stringify(report, null, 2)}\n`],
  [join(directory, `${phase}.tap`), result.stdout + result.stderr],
]);
console.log(JSON.stringify({ phase, status: result.status, sourceSha256: report.sourceSha256, bundleSha256: report.bundleSha256, observations: observations.map(record => record.kind === "native" ? { consumer: record.consumer, formats: record.observations.map(item => ({ format: item.format, type: item.type, size: item.size, status: item.extraction.status })) } : { kind: record.kind, archiveSha256: record.archiveSha256 }) }, null, 2));
assert.equal(result.status, phase === "baseline" ? 1 : 0);
