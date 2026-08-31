import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertAdmittedInputPath, assertLiteralInputPath, readRegularInput } from "../../../scripts/typecheck-integration-inputs.mjs";
import { assertCanonicalRoot, assertDistContinuity, assertTypeOrigins, authority, captureDistBaseline, contained, copyRegularTree, digest, inspectCommittedCandidate, packagePrefix, readArchive, readDistInventory, resolveTools } from "./committed-archive.mjs";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const actualRepository = resolve(authority, "../..");

export function assertSnapshotInputs(snapshotRoot, committedFiles, { peer, fileSystem = { readdirSync, lstatSync, readFileSync } } = {}) {
  const expected = new Map([...committedFiles].map(([path, bytes]) => [path, digest(bytes)]));
  for (const { path, sha256 } of peer?.files ?? []) {
    assertLiteralInputPath(path);
    for (const destination of [path, `${packagePrefix}/node_modules/poe-code/${path}`]) {
      if (expected.has(destination)) assert.equal(expected.get(destination), sha256, `snapshot authority conflict: ${destination}`);
      expected.set(destination, sha256);
    }
  }
  const paths = [];
  const visit = local => {
    for (const entry of fileSystem.readdirSync(join(snapshotRoot, local), { withFileTypes: true })) {
      const path = local ? `${local}/${entry.name}` : entry.name;
      if (path === "node_modules" || path === `${packagePrefix}/dist`) continue;
      assertLiteralInputPath(path);
      assert.ok(!entry.isSymbolicLink(), `snapshot input symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else paths.push(path);
    }
  };
  visit("");
  assert.deepEqual(paths.sort(), [...expected.keys()].sort(), "snapshot contains missing or new committed inputs");
  for (const [path, sha256] of expected) {
    const bytes = readRegularInput(snapshotRoot, path, 16 * 1024 * 1024, fileSystem);
    if (committedFiles.has(path)) assert.deepEqual(bytes, committedFiles.get(path), `snapshot input changed: ${path}`);
    assert.equal(digest(bytes), sha256, `snapshot input changed: ${path}`);
  }
}

function bindPackedConsumer(consumer, packedFiles, peer, declarations, ts) {
  const binding = { files: {}, metadata: ["node_modules/virtual-bash/package.json", "node_modules/poe-code/package.json"], entries: {
    "virtual-bash": "node_modules/virtual-bash/dist/index.js", "virtual-bash/fs/s3/http": "node_modules/virtual-bash/dist/fs/s3/http/index.js",
    "poe-code/safe-fs": `node_modules/poe-code/${peer.entries["poe-code/safe-fs"]}`,
  }, edges: {}, declarations: [], declarationEntries: {} };
  for (const path of packedFiles) binding.files[`node_modules/virtual-bash/${path}`] = digest(readRegularInput(consumer, `node_modules/virtual-bash/${path}`, 32 * 1024 * 1024));
  for (const { path, sha256 } of peer.files) binding.files[`node_modules/poe-code/${path}`] = sha256;
  for (const [specifier, path] of declarations.publicEntries) binding.declarationEntries[specifier] = `node_modules/poe-code/${path}`;
  binding.declarations = [...declarations.declarations.keys()].map(path => `node_modules/poe-code/${path}`);
  const pending = Object.values(binding.entries);
  while (pending.length) {
    const local = pending.pop();
    if (Object.hasOwn(binding.edges, local)) continue;
    assert.ok(Object.keys(binding.edges).length < 1024, "Runtime closure exceeds member bound");
    assert.ok(Object.hasOwn(binding.files, local), `Unbound runtime input: ${local}`);
    const bytes = readRegularInput(consumer, local, 16 * 1024 * 1024);
    assert.equal(digest(bytes), binding.files[local], `Runtime input drift: ${local}`);
    const source = ts.createSourceFile(local, bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, `Invalid runtime syntax: ${local}`);
    const imports = new Set();
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        assert.ok(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]), "Unbound dynamic runtime import");
        imports.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const edges = binding.edges[local] = {};
    for (const specifier of imports) {
      if (isBuiltin(specifier)) { edges[specifier] = specifier.startsWith("node:") ? specifier : `node:${specifier}`; continue; }
      const target = specifier.startsWith(".") ? relative(consumer, resolve(consumer, dirname(local), specifier)) : binding.entries[specifier];
      assert.equal(typeof target, "string", `Unbound runtime dependency: ${specifier}`);
      assert.ok(Object.hasOwn(binding.files, target), `Runtime dependency outside authenticated packages: ${target}`);
      if (local.startsWith("node_modules/poe-code/")) assert.ok(target.startsWith("node_modules/poe-code/"), "Canonical peer dependency escaped its package");
      edges[specifier] = target; pending.push(target);
    }
  }
  return binding;
}

export async function verifyCommittedExports({ repository = actualRepository, revision = "HEAD", reportPath, peerArtifact } = {}) {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "safe-bash-http-exports-")));
  const steps = [];
  const report = {
    capturedAt: new Date().toISOString(), requestedRevision: revision, node: process.version,
    platform: process.platform, arch: process.arch, status: "running", steps,
    scope: "mechanical committed private-package ESM/declaration integration; no HTTP operations, root release packaging, or service acceptance",
    qualification: realpathSync(repository) === realpathSync(actualRepository) ? "actual-integrated-commit" : "synthetic-committed-fixture-not-release-qualification",
  };
  try {
    const candidate = inspectCommittedCandidate(repository, revision, tempRoot);
    const { environment, manifest } = candidate;
    let peer, peerDeclarations, peerApi;
    if (manifest.peerDependencies?.["poe-code"]) {
      const checkout = peerArtifact === undefined && manifest.poeCode?.integration?.peerProfile === "checkout-root";
      assert.ok(checkout || typeof peerArtifact === "string", "Canonical-peer candidate requires an explicit published-peer artifact unless its manifest selects checkout-root");
      const { createPeerBinding } = await import("../../../scripts/typecheck-consumers.mjs");
      peerApi = await import("../../plugins/qualified-current-release/peer.mjs");
      const peerAuthority = join(repository, packagePrefix);
      assert.deepEqual(candidate.files.get(`${packagePrefix}/package.json`), readRegularInput(peerAuthority, "package.json", 300000), "Peer binding requires the selected committed package metadata");
      assert.deepEqual(candidate.files.get("package-lock.json"), readRegularInput(repository, "package-lock.json", 16 * 1024 * 1024), "Peer binding requires the selected committed workspace lock");
      if (manifest.poeCode?.integration?.peerProfile === "checkout-root") assert.deepEqual(candidate.files.get("package.json"), readRegularInput(repository, "package.json", 300000), "Peer binding requires the selected committed root metadata");
      report.peerPrerequisite = checkout ? "Existing matching root npm run build outputs, including the canonical shared SafeJS bundle; no implicit build, registry fallback or published-version qualification" : "Explicit matching peer artifact and built declaration/runtime tooling";
      peerDeclarations = createPeerBinding(peerAuthority, manifest);
      peer = peerApi.bindPeerArtifact({ root: peerAuthority, artifact: peerArtifact, declarations: { peer: peerDeclarations }, checkout });
      if (peer.profile === "packed-root" || peer.profile === "checkout-root") assert.equal(peer.metadataSha256, digest(candidate.files.get("package.json")), "Peer root metadata differs from the committed root");
      report.peer = peer;
      report.scope += checkout ? "; manifest-selected built checkout peer, not published peer-range satisfaction" : "; explicit canonical peer artifact, not published peer-range satisfaction for a development root";
    }
    report.sourceCommit = candidate.sourceCommit;
    report.blobReads = candidate.blobReads;
    report.withheldPaths = candidate.withheldPaths;
    const run = (label, command, args, cwd, expectedStatus = 0) => {
      const started = performance.now();
      const result = spawnSync(command, args, { cwd, env: environment, encoding: "utf8", timeout: 90000, maxBuffer: 16 * 1024 * 1024 });
      steps.push({ label, command, args, cwd, status: result.status, signal: result.signal,
        durationMs: Math.round(performance.now() - started), stdout: result.stdout, stderr: result.stderr });
      assert.ifError(result.error);
      assert.equal(result.signal, null, `${label} terminated by signal`);
      assert.equal(result.status, expectedStatus, `${label}\n${result.stdout}\n${result.stderr}`);
      return result.stdout.trim();
    };
    report.harness = Object.fromEntries(["verify.mjs", "committed-archive.mjs", "exports.test.ts", "archive-controls.test.mjs", "fixtures/runtime.mjs", "fixtures/consumer.ts.fixture", "fixtures/invalid.ts.fixture"].map(path => [path, digest(readRegularInput(fixtureRoot, path, 300000))]));
    const tools = resolveTools();
    report.tools = { packages: tools.identities, npmCli: tools.npmCli, node: process.execPath };
    for (const [name, identity] of Object.entries(tools.identities)) {
      const lockPath = relative(actualRepository, identity.root);
      assertLiteralInputPath(lockPath);
      assert.equal(candidate.lock.packages[lockPath]?.version, identity.version, `workspace lock does not bind installed ${name}: ${lockPath}`);
    }
    const staging = join(tempRoot, "committed-inputs");
    const snapshotRoot = join(tempRoot, "snapshot");
    const snapshot = join(snapshotRoot, packagePrefix);
    const consumer = join(tempRoot, "consumer");
    for (const directory of [staging, snapshotRoot, consumer]) mkdirSync(directory);
    const archivePaths = [...candidate.files.keys()].sort();
    report.archivePaths = archivePaths;
    for (const [path, bytes] of candidate.files) {
      mkdirSync(dirname(join(staging, path)), { recursive: true });
      writeFileSync(join(staging, path), bytes);
    }
    const sourceTar = join(tempRoot, "committed-source.tar");
    tools.tar.c({ cwd: staging, file: sourceTar, sync: true, portable: true, noPax: true }, archivePaths);
    const archiveBytes = readRegularInput(tempRoot, "committed-source.tar", 128 * 1024 * 1024);
    report.archive = { sha256: digest(archiveBytes), bytes: archiveBytes.length, method: "exact admitted Git blobs, verified object IDs; no git-archive attributes or live source overlay" };
    const extracted = await readArchive(tools.tar, sourceTar, report.archive.sha256, path => assert.ok(candidate.files.has(path), `unadmitted source archive path: ${path}`));
    assert.deepEqual([...extracted.keys()].sort(), archivePaths, "source archive inventory drift");
    for (const [path, bytes] of extracted) {
      assert.deepEqual(bytes, candidate.files.get(path), `source archive drift: ${path}`);
      mkdirSync(dirname(join(snapshotRoot, path)), { recursive: true });
      writeFileSync(join(snapshotRoot, path), bytes);
    }
    const assertSnapshot = stagedPeer => {
      assertSnapshotInputs(snapshotRoot, candidate.files, { peer: stagedPeer });
      assert.equal(digest(readRegularInput(tempRoot, "committed-source.tar", 128 * 1024 * 1024)), report.archive.sha256);
    };
    assertSnapshot();
    report.tools.copied = {};
    for (const [name, root] of Object.entries(tools.packages)) report.tools.copied[name] = copyRegularTree(root, join(snapshotRoot, "node_modules", name));
    const compiler = join(snapshotRoot, "node_modules/typescript/bin/tsc");
    if (peer) {
      peerApi.stagePeerArtifact(peer, snapshot);
      for (const { path, sha256 } of peer.files) {
        const bytes = readRegularInput(join(snapshot, "node_modules/poe-code"), path, 16 * 1024 * 1024);
        assert.equal(digest(bytes), sha256);
        if (candidate.files.has(path)) assert.deepEqual(bytes, candidate.files.get(path));
        else { mkdirSync(dirname(join(snapshotRoot, path)), { recursive: true }); writeFileSync(join(snapshotRoot, path), bytes, { flag: "wx" }); }
      }
    }
    run("TypeScript version", process.execPath, [compiler, "--version"], snapshot);
    run("committed output guard", process.execPath, [join(snapshotRoot, "scripts/guard-package-dist.mjs")], snapshot);
    run("committed boundary owner authentication", process.execPath, ["--input-type=module", "-e", "const {loadBoundaries}=await import(process.argv[1]); loadBoundaries(process.cwd());", pathToFileURL(join(snapshot, "scripts/integration-inputs.mjs")).href], snapshot);
    report.build = { command: manifest.scripts.build, execution: "committed output guard + committed owner authentication + committed guarded compiler entrypoint; held filename census authenticated from Git tree metadata, never materialized" };
    run("isolated committed compiler build", process.execPath, ["scripts/build.mjs"], snapshot);
    const distIdentity = Object.freeze({ sourceCommit: candidate.sourceCommit, archiveSha256: report.archive.sha256 });
    const baseline = captureDistBaseline(snapshot, distIdentity);
    report.distBaseline = baseline;
    report.distChecks = [];
    const checkDist = (label, files) => {
      assertDistContinuity(baseline, files, distIdentity);
      report.distChecks.push(label);
    };
    assertSnapshot(peer);
    const packRoot = join(tempRoot, "package-to-pack");
    mkdirSync(packRoot);
    for (const path of ["package.json", "README.md"]) writeFileSync(join(packRoot, path), candidate.files.get(`${packagePrefix}/${path}`));
    copyRegularTree(join(snapshot, "dist"), join(packRoot, "dist"));
    checkDist("copied", readDistInventory(packRoot));
    const tarball = join(tempRoot, "virtual-bash.tgz");
    run("isolated lifecycle-free package archive", process.execPath, ["-e", "require(process.argv[1])(process.argv[2], {ignoreScripts:true,offline:true}).then(bytes=>require('node:fs').writeFileSync(process.argv[3],bytes)).catch(error=>{console.error(error);process.exitCode=1});", tools.pack, packRoot, tarball], packRoot);
    const packedHash = digest(readRegularInput(tempRoot, "virtual-bash.tgz", 128 * 1024 * 1024));
    const expectedPackedPaths = new Set(baseline.files.map(entry => entry.path));
    const packed = await readArchive(tools.tar, tarball, packedHash, path => {
      assert.ok(path.startsWith("package/"), `package archive prefix: ${path}`);
      const local = path.slice("package/".length);
      if (local.startsWith("dist/")) assertAdmittedInputPath(`src/${local.slice(5)}`, candidate.boundaries);
      assert.ok(["package.json", "README.md"].includes(local) || expectedPackedPaths.has(local), `dist continuity unadmitted packed input: ${path}`);
    });
    const packedFiles = [...packed.keys()].map(path => path.slice("package/".length)).sort();
    checkDist("packed", packedFiles.filter(path => path.startsWith("dist/")).map(path => ({ path, sha256: digest(packed.get(`package/${path}`)) })));
    checkDist("copied after pack", readDistInventory(packRoot));
    for (const required of ["dist/index.js", "dist/index.d.ts", "dist/fs/s3/http/index.js", "dist/fs/s3/http/index.d.ts", "dist/fs/s3/http/types.d.ts"]) assert.ok(packedFiles.includes(required), `Missing packed ${required}`);
    for (const path of packedFiles) assert.deepEqual(packed.get(`package/${path}`), readRegularInput(packRoot, path, 32 * 1024 * 1024), `packed file drift: ${path}`);
    report.package = { name: manifest.name, version: manifest.version, fileCount: packedFiles.length, sha256: packedHash, runtimeDependencies: {}, peerDependencies: manifest.peerDependencies ?? {}, exports: manifest.exports, files: packedFiles };
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "s3-http-export-consumer", private: true, type: "module" }));
    run("offline tarball install without lifecycles", process.execPath, [tools.npmCli, "install", "--prefix", consumer, "--workspaces=false", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", ...(peer ? ["--legacy-peer-deps"] : []), tarball], consumer);
    if (peer) {
      peerApi.stagePeerArtifact(peer, consumer);
      peerApi.assertPeerArtifact(peer, consumer);
      report.peerInstallation = "explicit authenticated public closure after private-package install; npm peer resolution disabled, not a full root install graph qualification";
    }
    const installedRoot = join(consumer, "node_modules/virtual-bash");
    assertCanonicalRoot(installedRoot);
    assert.equal(lstatSync(installedRoot).isSymbolicLink(), false);
    assert.equal(existsSync(join(installedRoot, "src")), false);
    assert.deepEqual(JSON.parse(readRegularInput(installedRoot, "package.json", 300000)), manifest);
    for (const path of packedFiles) {
      assert.ok(contained(realpathSync(installedRoot), realpathSync(join(installedRoot, path))));
      assert.deepEqual(readRegularInput(installedRoot, path, 32 * 1024 * 1024), packed.get(`package/${path}`), `installed file drift: ${path}`);
    }
    writeFileSync(join(consumer, "runtime.mjs"), readRegularInput(fixtureRoot, "fixtures/runtime.mjs", 100000));
    checkDist("before runtime", readDistInventory(installedRoot));
    let bindingPath;
    if (peer) {
      const ts = (await import(pathToFileURL(join(tools.packages.typescript, "lib/typescript.js")).href)).default;
      const binding = bindPackedConsumer(consumer, packedFiles, peer, peerDeclarations, ts);
      bindingPath = join(consumer, "binding.json"); writeFileSync(bindingPath, JSON.stringify(binding)); report.peerRuntimeBinding = binding;
    }
    report.runtime = JSON.parse(run("plain Node packed imports and guard controls", process.execPath, [join(consumer, "runtime.mjs"), join(repository, packagePrefix, "src/fs/s3/http/index.ts"), ...(bindingPath ? [bindingPath] : [])], consumer));
    for (const name of ["@types/node", "undici-types"]) copyRegularTree(tools.packages[name], join(consumer, "node_modules", name));
    const compilerOptions = { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: false, noEmit: true, types: ["node"] };
    for (const basename of ["consumer", "invalid"]) {
      writeFileSync(join(consumer, `${basename}.ts`), readRegularInput(fixtureRoot, `fixtures/${basename}.ts.fixture`, 100000));
      writeFileSync(join(consumer, `tsconfig.${basename}.json`), JSON.stringify({ compilerOptions, files: [`${basename}.ts`] }));
    }
    checkDist("before strict types", readDistInventory(installedRoot));
    const typeFiles = run("strict public TypeScript consumer", process.execPath, [compiler, "-p", "tsconfig.consumer.json", "--listFiles", "--pretty", "false"], consumer).split("\n");
    assertTypeOrigins(typeFiles, consumer, installedRoot, join(snapshotRoot, "node_modules/typescript/lib"));
    if (peer) peerApi.assertPeerDeclarationFiles(peer, typeFiles, consumer);
    for (const entrypoint of ["dist/index.d.ts", "dist/fs/s3/http/index.d.ts", "dist/fs/s3/http/types.d.ts"]) assert.ok(typeFiles.includes(join(installedRoot, entrypoint)), `Types did not resolve ${entrypoint}`);
    report.typecheck = { compilerOptions, files: typeFiles, rootAndSubpathTypes: 4, sourceFallback: false };
    checkDist("before invalid types", readDistInventory(installedRoot));
    const diagnostics = run("strict invalid consumer controls", process.execPath, [compiler, "-p", "tsconfig.invalid.json", "--pretty", "false"], consumer, 2);
    const diagnosticCodes = [...diagnostics.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1])).sort();
    assert.deepEqual(diagnosticCodes, [2322, 2345, 2741]);
    report.typecheck.negativeDiagnosticCodes = diagnosticCodes;
    if (peer) {
      peerApi.assertPeerArtifact(peer, consumer); peerApi.assertPeerArtifact(peer, snapshot);
      for (const { path, sha256 } of peer.files) assert.equal(digest(readRegularInput(snapshotRoot, path, 16 * 1024 * 1024)), sha256, "Canonical build peer changed");
    }
    assertSnapshot(peer);
    for (const [label, root] of [["final built", snapshot], ["final copied", packRoot], ["final installed", installedRoot]]) checkDist(label, readDistInventory(root));
    assert.equal(digest(readRegularInput(tempRoot, "virtual-bash.tgz", 128 * 1024 * 1024)), packedHash);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.error = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    report.completedAt = new Date().toISOString();
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    rmSync(tempRoot, { recursive: true, force: true });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyCommittedExports({ revision: process.argv[2] ?? "HEAD", reportPath: process.argv[3] ? resolve(process.argv[3]) : undefined, peerArtifact: process.argv[4] ? resolve(process.argv[4]) : undefined });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}
