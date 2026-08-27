import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(fixtureRoot, "../../..");
const requestedRevision = process.argv[2] ?? "HEAD";
const reportPath = process.argv[3] ? resolve(process.argv[3]) : undefined;
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "safe-bash-http-exports-")));
const snapshot = join(tempRoot, "snapshot");
const consumer = join(tempRoot, "consumer");
const environment = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: join(tempRoot, "home"), TMPDIR: join(tempRoot, "tmp"),
  npm_config_cache: join(tempRoot, "npm-cache"),
  npm_config_userconfig: join(tempRoot, "empty.npmrc"),
  npm_config_globalconfig: join(tempRoot, "empty-global.npmrc"),
  npm_config_registry: "http://127.0.0.1:1", npm_config_offline: "true",
  npm_config_audit: "false", npm_config_fund: "false", npm_config_ignore_scripts: "true",
  LC_ALL: "C", TZ: "UTC",
};
for (const directory of [snapshot, consumer, environment.HOME, environment.TMPDIR]) mkdirSync(directory, { recursive: true });
writeFileSync(environment.npm_config_userconfig, "");
writeFileSync(environment.npm_config_globalconfig, "");
const steps = [];
const report = {
  capturedAt: new Date().toISOString(), requestedRevision, node: process.version,
  platform: process.platform, arch: process.arch, status: "running", steps,
  scope: "mechanical packed ESM/declaration integration; no HTTP operations or service acceptance",
};

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(label, command, args, cwd = repository, expectedStatus = 0) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd, env: environment, encoding: "utf8", timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
  });
  steps.push({ label, command, args, cwd, status: result.status, signal: result.signal,
    durationMs: Math.round(performance.now() - started), stdout: result.stdout, stderr: result.stderr });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${label} terminated by signal`);
  assert.equal(result.status, expectedStatus, `${label}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function contained(root, filename) {
  const local = relative(root, filename);
  return !isAbsolute(local) && local !== ".." && !local.startsWith("../");
}

try {
  report.sourceCommit = run("resolve source revision", "git", ["rev-parse", "--verify", `${requestedRevision}^{commit}`]);
  report.harnessHead = run("capture harness HEAD", "git", ["rev-parse", "HEAD"]);
  report.harnessStatus = run("capture owned test status", "git", ["status", "--porcelain", "--", relative(repository, fixtureRoot)]);
  report.fixtures = Object.fromEntries([
    "verify.mjs", "exports.test.ts", "README.md", "fixtures/runtime.mjs",
    "fixtures/consumer.ts.fixture", "fixtures/invalid.ts.fixture",
  ].map((filename) => [filename, digest(readFileSync(join(fixtureRoot, filename)))]));
  const archive = join(tempRoot, "source.tar");
  run("archive committed source", "git", ["archive", "--format=tar", `--output=${archive}`, report.sourceCommit,
    "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"]);
  run("extract source snapshot", "tar", ["-xf", archive, "-C", snapshot]);
  report.sourceArchiveSha256 = digest(readFileSync(archive));
  const sourceFiles = run("enumerate source bindings", "git", ["ls-tree", "-r", "--name-only", report.sourceCommit,
    "src/fs/s3/http", "src/index.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]);
  report.sourceHashes = Object.fromEntries(sourceFiles.split("\n").map((filename) => [filename, digest(readFileSync(join(snapshot, filename)))]));
  const manifest = JSON.parse(readFileSync(join(snapshot, "package.json"), "utf8"));
  for (const kind of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    assert.deepEqual(Object.keys(manifest[kind] ?? {}), [], `${kind} must remain empty`);
  }
  const lock = JSON.parse(readFileSync(join(snapshot, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].name, manifest.name);
  assert.equal(lock.packages[""].version, manifest.version);
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  assert.deepEqual(lock.packages[""].dependencies ?? {}, {});
  assert.equal(existsSync(join(snapshot, "dist")), false);
  symlinkSync(realpathSync(join(repository, "node_modules")), join(snapshot, "node_modules"), "dir");
  report.npm = run("npm version", "npm", ["--version"]);
  report.typescript = run("TypeScript version", process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "--version"]);
  run("clean snapshot build", "npm", ["run", "build"], snapshot);
  const packed = JSON.parse(run("pack built snapshot", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", tempRoot], snapshot));
  assert.equal(packed.length, 1);
  const artifact = packed[0];
  const tarball = join(tempRoot, artifact.filename);
  const packedFiles = artifact.files.map((entry) => entry.path);
  for (const required of ["dist/index.js", "dist/index.d.ts", "dist/fs/s3/http/index.js", "dist/fs/s3/http/index.d.ts", "dist/fs/s3/http/types.d.ts"]) {
    assert.ok(packedFiles.includes(required), `Missing packed ${required}`);
  }
  assert.ok(packedFiles.every((filename) => !/^(src|tests|node_modules)\//u.test(filename)));
  report.package = { name: artifact.name, version: artifact.version, fileCount: packedFiles.length,
    integrity: artifact.integrity, sha256: digest(readFileSync(tarball)), runtimeDependencies: {},
    exports: manifest.exports, files: packedFiles };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "s3-http-export-consumer", private: true, type: "module" }));
  run("offline tarball install", "npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", tarball], consumer);
  const installedRoot = join(consumer, "node_modules/virtual-bash");
  assert.equal(lstatSync(installedRoot).isSymbolicLink(), false);
  assert.equal(existsSync(join(installedRoot, "src")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8")), manifest);
  for (const filename of packedFiles) {
    const installed = join(installedRoot, filename);
    assert.ok(contained(realpathSync(installedRoot), realpathSync(installed)));
    assert.equal(digest(readFileSync(installed)), digest(readFileSync(join(snapshot, filename))), filename);
  }
  cpSync(join(fixtureRoot, "fixtures/runtime.mjs"), join(consumer, "runtime.mjs"));
  report.runtime = JSON.parse(run("plain Node packed imports and guard controls", process.execPath,
    [join(consumer, "runtime.mjs"), join(repository, "src/fs/s3/http/index.ts")], consumer));
  for (const tooling of ["@types/node", "undici-types"]) {
    cpSync(realpathSync(join(repository, "node_modules", tooling)), join(consumer, "node_modules", tooling), { recursive: true });
  }
  for (const basename of ["consumer", "invalid"]) {
    cpSync(join(fixtureRoot, `fixtures/${basename}.ts.fixture`), join(consumer, `${basename}.ts`));
  }
  const compilerOptions = {
    target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true, skipLibCheck: false, noEmit: true, types: ["node"],
  };
  for (const basename of ["consumer", "invalid"]) {
    writeFileSync(join(consumer, `tsconfig.${basename}.json`), JSON.stringify({ compilerOptions, files: [`${basename}.ts`] }));
  }
  const compiler = realpathSync(join(repository, "node_modules/typescript/bin/tsc"));
  const typeFiles = run("strict public TypeScript consumer", process.execPath,
    [compiler, "-p", "tsconfig.consumer.json", "--listFiles", "--pretty", "false"], consumer).split("\n");
  const libraryRoot = realpathSync(join(repository, "node_modules/typescript/lib"));
  for (const filename of typeFiles) {
    const canonical = realpathSync(filename.trim());
    assert.ok(contained(consumer, canonical) || (contained(libraryRoot, canonical) && /^lib\..*\.d\.ts$/u.test(relative(libraryRoot, canonical))),
      `TypeScript source fallback: ${canonical}`);
    if (contained(installedRoot, canonical)) assert.ok(canonical.includes("/dist/") && canonical.endsWith(".d.ts"));
  }
  for (const entrypoint of ["dist/index.d.ts", "dist/fs/s3/http/index.d.ts", "dist/fs/s3/http/types.d.ts"]) {
    assert.ok(typeFiles.includes(join(installedRoot, entrypoint)), `Types did not resolve ${entrypoint}`);
  }
  report.typecheck = { compilerOptions, files: typeFiles, rootAndSubpathTypes: 4, sourceFallback: false };
  const diagnostics = run("strict invalid consumer controls", process.execPath,
    [compiler, "-p", "tsconfig.invalid.json", "--pretty", "false"], consumer, 2);
  const diagnosticCodes = [...diagnostics.matchAll(/error TS(\d+):/gu)].map((match) => Number(match[1])).sort();
  assert.deepEqual(diagnosticCodes, [2322, 2345, 2741]);
  report.typecheck.negativeDiagnosticCodes = diagnosticCodes;
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  rmSync(tempRoot, { recursive: true, force: true });
}
