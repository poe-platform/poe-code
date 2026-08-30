import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire, isBuiltin } from "node:module";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBoundFile } from "./fixtures/runtime.mjs";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(fixtureRoot, "../../..");
const requestedRevision = process.argv[2] ?? "HEAD";
const worktree = requestedRevision === "WORKTREE";
const reportPath = process.argv[3] ? resolve(process.argv[3]) : undefined;
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "safe-bash-http-exports-")));
const snapshot = join(tempRoot, "snapshot");
const consumer = join(tempRoot, "consumer");
const environment = {
  PATH: process.env.PATH ?? "",
  GIT_EXEC_PATH: "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core",
  GIT_OPTIONAL_LOCKS: "0",
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
  let executable = command, executionArgs = args;
  if (command === "git") {
    executable = "/Applications/Xcode.app/Contents/Developer/usr/bin/git";
    const stat = lstatSync(executable);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(realpathSync(executable), executable);
    assert.equal(stat.size, 3704880);
    assert.equal(stat.mode & 0o777, 0o755);
    assert.equal(digest(readFileSync(executable)), "10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9");
    assert.equal(realpathSync(environment.GIT_EXEC_PATH), environment.GIT_EXEC_PATH);
  }
  if (command === "npm") {
    const cli = "/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js";
    const stat = lstatSync(cli);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(realpathSync(cli), cli);
    assert.equal(stat.size, 54);
    assert.equal(stat.mode & 0o777, 0o755);
    assert.equal(digest(readFileSync(cli)), "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7");
    executable = process.execPath;
    executionArgs = [cli, ...args];
  }
  const result = spawnSync(executable, executionArgs, {
    cwd, env: environment, encoding: "utf8", timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
  });
  steps.push({ label, command, executable, args, executionArgs, cwd, status: result.status, signal: result.signal,
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

function regularBytes(filename, limit = 16 * 1024 * 1024) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, `Expected bounded regular input: ${filename}`);
  assert.equal(realpathSync(filename), filename, `Input redirects through symlink: ${filename}`);
  return readFileSync(filename);
}

function conditionalTarget(entry, conditions) {
  if (typeof entry === "string" || entry === null) return entry;
  if (!entry || Array.isArray(entry) || typeof entry !== "object") return undefined;
  for (const [condition, value] of Object.entries(entry)) {
    if (!conditions.includes(condition)) continue;
    const target = conditionalTarget(value, conditions);
    if (target !== undefined) return target;
  }
}

const productPaths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"];
function captureWorktree(copy = false) {
  const paths = run("enumerate actual worktree product inputs", "git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...productPaths]).split("\0").filter(Boolean);
  const deleted = new Set(run("enumerate actual worktree deletions", "git", ["ls-files", "-z", "--deleted", "--", ...productPaths]).split("\0").filter(Boolean));
  const hashes = {};
  let size = 0;
  for (const filename of [...new Set(paths)].sort()) {
    if (deleted.has(filename)) continue;
    assert.ok(contained(repository, resolve(repository, filename)), `Input escaped repository: ${filename}`);
    const bytes = regularBytes(join(repository, filename));
    size += bytes.length;
    assert.ok(size <= 64 * 1024 * 1024, "Worktree product input exceeds byte bound");
    hashes[filename] = digest(bytes);
    if (copy) { mkdirSync(dirname(join(snapshot, filename)), { recursive: true }); writeFileSync(join(snapshot, filename), bytes); }
  }
  for (const filename of productPaths.slice(1)) assert.ok(Object.hasOwn(hashes, filename), `Missing product input: ${filename}`);
  assert.ok(Object.keys(hashes).some(filename => filename.startsWith("src/")), "Product sources missing");
  return { hashes, deleted: [...deleted].sort(), size };
}

function bindPeer(manifest) {
  assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}), ["poe-code"]);
  assert.notEqual(manifest.peerDependenciesMeta?.["poe-code"]?.optional, true, "Canonical peer must be required");
  const locked = JSON.parse(readFileSync(join(snapshot, "package-lock.json"))).packages["node_modules/poe-code"];
  assert.equal(locked.version, manifest.devDependencies["poe-code"], "Required peer must match exact development pin");
  assert.equal(locked.resolved, `https://registry.npmjs.org/poe-code/-/poe-code-${locked.version}.tgz`, "Peer must identify the actual registry artifact");
  const peerTarball = process.argv[4] ?? process.env.S3_HTTP_EXPORTS_PEER_TARBALL;
  assert.equal(typeof peerTarball, "string", "Required-peer profiles need the exact peer tarball as fourth argument or S3_HTTP_EXPORTS_PEER_TARBALL");
  const bytes = regularBytes(realpathSync(resolve(peerTarball)), 64 * 1024 * 1024);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.equal(integrity, locked.integrity, "Required peer tarball SRI mismatch");
  const pinned = join(tempRoot, "canonical-peer.tgz"); writeFileSync(pinned, bytes);
  const entries = run("inspect authenticated peer tarball", "tar", ["-tzf", pinned]).split("\n");
  assert.ok(entries.length > 0 && entries.length <= 20_000);
  assert.equal(new Set(entries).size, entries.length);
  assert.ok(entries.every(path => path.startsWith("package/") && !path.split("/").includes("..") && !path.includes("\\")), "Peer archive contains unsafe paths");
  const directory = join(tempRoot, "peer"); mkdirSync(directory);
  run("extract authenticated peer", "tar", ["-xzf", pinned, "-C", directory]);
  const root = join(directory, "package"), metadata = regularBytes(join(root, "package.json")), peer = JSON.parse(metadata);
  assert.equal(peer.name, "poe-code"); assert.equal(peer.version, locked.version);
  assert.equal(digest(metadata), digest(regularBytes(join(realpathSync(join(repository, "node_modules/poe-code")), "package.json"))), "Build peer metadata differs from authenticated artifact");
  const semver = createRequire(import.meta.url)(join(repository, "node_modules/semver"));
  assert.ok(semver.satisfies(peer.version, manifest.peerDependencies["poe-code"]), "Published peer does not satisfy required range");
  return { root, peer, version: peer.version, integrity, tarballSha256: digest(bytes), metadataSha256: digest(metadata) };
}

function bindConsumer(peer, packedFiles) {
  const ts = createRequire(import.meta.url)(join(repository, "node_modules/typescript"));
  const root = join(consumer, "node_modules/poe-code");
  const binding = { files: {}, metadata: ["node_modules/virtual-bash/package.json", "node_modules/poe-code/package.json"], entries: {
    "virtual-bash": "node_modules/virtual-bash/dist/index.js",
    "virtual-bash/fs/s3/http": "node_modules/virtual-bash/dist/fs/s3/http/index.js",
  }, edges: {}, declarations: [], declarationEntries: {} };
  for (const filename of packedFiles) binding.files[`node_modules/virtual-bash/${filename}`] = digest(regularBytes(join(consumer, "node_modules/virtual-bash", filename)));
  binding.files["node_modules/poe-code/package.json"] = peer.metadataSha256;
  const capture = filename => {
    assert.ok(contained(root, filename), `Peer closure escaped: ${filename}`);
    const local = relative(root, filename);
    assert.ok(local.startsWith("packages/") && local.includes("/dist/"), `Peer closure requires built packages: ${local}`);
    const bytes = regularBytes(filename);
    assert.equal(digest(bytes), digest(regularBytes(join(peer.root, local))), `Installed peer differs from SRI artifact: ${local}`);
    const tools = join(realpathSync(join(repository, "node_modules/poe-code")), local);
    assert.equal(digest(regularBytes(tools)), digest(bytes), `Build tooling peer differs from artifact: ${local}`);
    binding.files[relative(consumer, filename)] = digest(bytes);
    return bytes;
  };
  const runtimeTarget = conditionalTarget(peer.peer.exports["./safe-fs"], ["node", "import", "default"]);
  assert.equal(typeof runtimeTarget, "string");
  binding.entries["poe-code/safe-fs"] = relative(consumer, resolve(root, runtimeTarget));
  const pending = Object.values(binding.entries);
  while (pending.length) {
    const local = pending.pop(); if (Object.hasOwn(binding.edges, local)) continue;
    assert.ok(Object.keys(binding.edges).length < 1024, "Runtime closure exceeds file bound");
    assert.ok(local.endsWith(".js") || local.endsWith(".mjs"), "Runtime requires built ESM");
    const filename = join(consumer, local);
    const bytes = contained(root, filename) ? capture(filename) : regularBytes(filename);
    assert.equal(digest(bytes), binding.files[local], `Runtime bytes not in package: ${local}`);
    const edges = binding.edges[local] = {};
    const imports = new Set();
    const source = ts.createSourceFile(filename, bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, `Cannot parse authenticated runtime: ${local}`);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const fileName of imports) {
      if (isBuiltin(fileName)) { edges[fileName] = fileName.startsWith("node:") ? fileName : `node:${fileName}`; continue; }
      let target;
      if (fileName.startsWith(".")) target = relative(consumer, resolve(dirname(filename), fileName));
      else { assert.equal(fileName, "poe-code/safe-fs", `Unreviewed runtime dependency: ${fileName}`); target = binding.entries[fileName]; }
      if (contained(root, filename)) assert.ok(contained(root, join(consumer, target)), "Peer relative import escaped package");
      edges[fileName] = target; pending.push(target);
    }
  }
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2023 };
  const declarationTarget = conditionalTarget(peer.peer.exports["./safe-fs"], ["types", "node", "import", "default"]);
  assert.equal(typeof declarationTarget, "string");
  binding.declarationEntries["poe-code/safe-fs"] = relative(consumer, resolve(root, declarationTarget));
  const declarations = [resolve(root, declarationTarget)], seen = new Set();
  while (declarations.length) {
    const filename = declarations.pop(); if (seen.has(filename)) continue;
    assert.ok(seen.size < 256, "Declaration closure exceeds file bound"); seen.add(filename);
    assert.ok(filename.endsWith(".d.ts") || filename.endsWith(".d.mts"), "Peer closure requires declarations");
    const inputs = ts.preProcessFile(capture(filename).toString(), true);
    binding.declarations.push(relative(consumer, filename));
    assert.equal(inputs.referencedFiles.length, 0, "Peer path reference is not admitted");
    assert.ok(inputs.typeReferenceDirectives.every(reference => reference.fileName === "node"));
    for (const { fileName } of inputs.importedFiles) {
      if (isBuiltin(fileName)) continue;
      assert.ok(fileName.startsWith(".") || fileName === "#safe-fs-platform", `Unreviewed declaration dependency: ${fileName}`);
      const resolved = ts.resolveModuleName(fileName, filename, options, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
      assert.ok(resolved, `Unresolved peer type: ${fileName}`);
      if (fileName === "#safe-fs-platform") {
        const target = conditionalTarget(peer.peer.imports?.[fileName], ["types", "node", "import", "default"]);
        assert.equal(typeof target, "string"); assert.equal(resolved.resolvedFileName, resolve(root, target));
      }
      declarations.push(resolved.resolvedFileName);
    }
  }
  for (const path of Object.keys(binding.files)) assertBoundFile(consumer, binding, path);
  return binding;
}

try {
  report.profile = worktree ? "source-pinned-WORKTREE" : "historical-committed-revision";
  report.sourceCommit = worktree ? null : run("resolve source revision", "git", ["rev-parse", "--verify", `${requestedRevision}^{commit}`]);
  report.harnessHead = run("capture harness HEAD", "git", ["rev-parse", "HEAD"]);
  report.harnessStatus = run("capture owned test status", "git", ["status", "--porcelain", "--", relative(repository, fixtureRoot)]);
  report.fixtures = Object.fromEntries([
    "verify.mjs", "exports.test.ts", "README.md", "fixtures/runtime.mjs",
    "fixtures/consumer.ts.fixture", "fixtures/invalid.ts.fixture",
  ].map((filename) => [filename, digest(readFileSync(join(fixtureRoot, filename)))]));
  if (worktree) {
    report.worktree = captureWorktree(true);
    report.sourceHashes = report.worktree.hashes;
  } else {
  const archive = join(tempRoot, "source.tar");
  run("archive committed source", "git", ["archive", "--format=tar", `--output=${archive}`, report.sourceCommit,
    "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"]);
  run("extract source snapshot", "tar", ["-xf", archive, "-C", snapshot]);
  report.sourceArchiveSha256 = digest(readFileSync(archive));
  const sourceFiles = run("enumerate source bindings", "git", ["ls-tree", "-r", "--name-only", report.sourceCommit,
    "src/fs/s3/http", "src/index.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]);
  report.sourceHashes = Object.fromEntries(sourceFiles.split("\n").map((filename) => [filename, digest(readFileSync(join(snapshot, filename)))]));
  }
  const manifest = JSON.parse(readFileSync(join(snapshot, "package.json"), "utf8"));
  const canonicalPeer = worktree || Object.keys(manifest.peerDependencies ?? {}).length > 0;
  for (const kind of ["dependencies", "optionalDependencies", ...(canonicalPeer ? [] : ["peerDependencies"])]) {
    assert.deepEqual(Object.keys(manifest[kind] ?? {}), [], `${kind} must remain empty`);
  }
  const lock = JSON.parse(readFileSync(join(snapshot, "package-lock.json"), "utf8"));
  const peer = canonicalPeer ? bindPeer(manifest) : undefined;
  if (peer && !worktree) report.profile = "authenticated-peer-committed-revision";
  if (peer) report.peer = { version: peer.version, integrity: peer.integrity, tarballSha256: peer.tarballSha256, metadataSha256: peer.metadataSha256 };
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
  for (const required of ["dist/index.js", "dist/index.d.ts", "dist/fs/s3/http/index.js", "dist/fs/s3/http/index.d.ts", ...(peer ? [] : ["dist/fs/s3/http/types.d.ts"])]) {
    assert.ok(packedFiles.includes(required), `Missing packed ${required}`);
  }
  assert.ok(packedFiles.every((filename) => !/^(src|tests|node_modules)\//u.test(filename)));
  report.package = { name: artifact.name, version: artifact.version, fileCount: packedFiles.length,
    integrity: artifact.integrity, sha256: digest(readFileSync(tarball)), runtimeDependencies: {},
    exports: manifest.exports, files: packedFiles };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "s3-http-export-consumer", private: true, type: "module" }));
  run("offline tarball install", "npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", ...(peer ? ["--legacy-peer-deps"] : []), tarball], consumer);
  if (peer) cpSync(peer.root, join(consumer, "node_modules/poe-code"), { recursive: true });
  const installedRoot = join(consumer, "node_modules/virtual-bash");
  assert.equal(lstatSync(installedRoot).isSymbolicLink(), false);
  assert.equal(existsSync(join(installedRoot, "src")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8")), manifest);
  for (const filename of packedFiles) {
    const installed = join(installedRoot, filename);
    assert.ok(contained(realpathSync(installedRoot), realpathSync(installed)));
    assert.equal(digest(readFileSync(installed)), digest(readFileSync(join(snapshot, filename))), filename);
  }
  const binding = peer ? bindConsumer(peer, packedFiles) : undefined;
  if (binding) { report.peer.binding = binding; writeFileSync(join(consumer, "binding.json"), JSON.stringify(binding)); }
  cpSync(join(fixtureRoot, "fixtures/runtime.mjs"), join(consumer, "runtime.mjs"));
  report.runtime = JSON.parse(run("plain Node packed imports and guard controls", process.execPath,
    [join(consumer, "runtime.mjs"), join(repository, "src/fs/s3/http/index.ts"), ...(binding ? [join(consumer, "binding.json")] : [])], consumer));
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
    if (binding && contained(join(consumer, "node_modules/poe-code"), canonical)) {
      assert.ok(binding.declarations.includes(relative(consumer, canonical)), "Declaration outside authenticated public closure");
      assertBoundFile(consumer, binding, relative(consumer, canonical));
    }
  }
  for (const entrypoint of ["dist/index.d.ts", "dist/fs/s3/http/index.d.ts", ...(peer ? [] : ["dist/fs/s3/http/types.d.ts"])]) {
    assert.ok(typeFiles.includes(join(installedRoot, entrypoint)), `Types did not resolve ${entrypoint}`);
  }
  report.typecheck = { compilerOptions, files: typeFiles, rootAndSubpathTypes: 4, sourceFallback: false };
  const diagnostics = run("strict invalid consumer controls", process.execPath,
    [compiler, "-p", "tsconfig.invalid.json", "--pretty", "false"], consumer, 2);
  const diagnosticCodes = [...diagnostics.matchAll(/error TS(\d+):/gu)].map((match) => Number(match[1])).sort();
  assert.deepEqual(diagnosticCodes, [2322, 2345, 2741]);
  report.typecheck.negativeDiagnosticCodes = diagnosticCodes;
  if (binding) {
    for (const path of Object.values(binding.declarationEntries)) assert.ok(typeFiles.includes(join(consumer, path)), `Public peer declaration entry not selected: ${path}`);
    const local = binding.declarationEntries["poe-code/safe-fs"], filename = join(consumer, local), original = readFileSync(filename);
    try { writeFileSync(filename, Buffer.concat([original, Buffer.from("\n ")])); assert.throws(() => assertBoundFile(consumer, binding, local)); }
    finally { writeFileSync(filename, original); }
    report.typecheck.peerDeclarationTamperRejected = true;
    for (const path of Object.keys(binding.files)) assertBoundFile(consumer, binding, path);
    if (worktree) assert.deepEqual(captureWorktree(), report.worktree, "Live worktree inputs changed during qualification");
  }
  for (const [filename, hash] of Object.entries(report.fixtures)) assert.equal(digest(readFileSync(join(fixtureRoot, filename))), hash, `Harness input changed: ${filename}`);
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
