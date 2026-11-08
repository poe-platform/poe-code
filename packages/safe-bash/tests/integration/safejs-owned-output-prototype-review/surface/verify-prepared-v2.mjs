import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const comparePaths = (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

function regular(filename) {
  assert.equal(realpathSync(filename), filename, `Symlink component: ${filename}`);
  assert.ok(lstatSync(filename).isFile(), `Not a regular file: ${filename}`);
  return readFileSync(filename);
}

function inventory(root) {
  assert.equal(realpathSync(root), root, `Symlink root: ${root}`);
  const entries = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Symlink entry: ${filename}`);
      if (entry.isDirectory()) visit(filename);
      else {
        const bytes = regular(filename);
        entries.push({ path: relative(root, filename), bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  visit(root);
  return entries.sort(comparePaths);
}

function gitObject(commit, filename) {
  return execFileSync("/usr/bin/git", ["show", `${commit}:${filename}`], {
    cwd: repository,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function verify() {
  assert.equal(process.env.NODE_OPTIONS ?? "", "", "No ambient Node preload/options");
  assert.deepEqual(process.execArgv, [], "Run this static checker without Node preload flags");
  const pins = JSON.parse(regular(join(owned, "PINS.json")));
  const cases = JSON.parse(regular(join(owned, "CASES.json")));
  const freeze = JSON.parse(regular(join(owned, "FREEZE-v2.json")));
  for (const entry of freeze.files) {
    const bytes = regular(join(owned, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
  assert.equal(freeze.status, "PREPARED_NOT_RELEASED");
  assert.equal(cases.cases.length, 9);
  assert.equal(cases.cases.filter(entry => !entry.conditional).length, 8);
  for (const shape of Object.values(cases.expectedShapes)) {
    const entries = new Map(shape.entries);
    assert.deepEqual(shape.keys, [...entries.keys()].sort());
    assert.deepEqual(shape.types, cases.sensitiveFields.map(field => [field, entries.get(field) ?? "undefined"]));
    assert.deepEqual(shape.own, cases.sensitiveFields.map(field => [field, entries.has(field)]));
  }
  for (const entry of cases.cases) {
    const bytes = regular(join(owned, entry.source.path));
    assert.equal(hash(bytes), entry.source.sha256, entry.id);
    assert.equal(bytes.length, entry.source.bytes, entry.id);
  }

  const receipts = new Map();
  for (const entry of pins.provenance.files) {
    const bytes = gitObject(pins.provenance.commit, entry.path);
    assert.equal(hash(bytes), entry.sha256, entry.path);
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.deepEqual(regular(join(repository, entry.path)), bytes, entry.path);
    receipts.set(entry.name, JSON.parse(bytes));
  }
  const assembly = receipts.get("assembly.json");
  const proof = receipts.get("build-proof.json");
  const snapshot = receipts.get("snapshot-after.json");
  const archiveBytes = gitObject(pins.candidate.evidenceCommit, pins.candidate.archive.path);
  assert.equal(hash(archiveBytes), pins.candidate.archive.sha256);
  assert.equal(archiveBytes.length, pins.candidate.archive.bytes);

  const candidate = inventory(join(pins.preparedRoot, "candidate"));
  assert.deepEqual(candidate, assembly.candidateFiles);
  assert.equal(candidate.length, 940);
  assert.equal(hash(JSON.stringify(candidate)), pins.candidate.inventorySha256);
  for (const [directory, count, expected] of [
    ["src", 213, pins.candidate.sourceManifestSha256],
    ["dist", 708, pins.candidate.compiledManifestSha256],
    ["tests", undefined, pins.candidate.testManifestSha256],
  ]) {
    const entries = candidate.filter(entry => entry.path.startsWith(`${directory}/`));
    if (count !== undefined) assert.equal(entries.length, count, directory);
    assert.equal(hash(JSON.stringify(entries)), expected, directory);
  }
  for (const entry of pins.productApiFiles) {
    assert.deepEqual(candidate.find(item => item.path === entry.path), entry, entry.path);
  }

  const consumer = inventory(join(pins.preparedRoot, "consumer/node_modules/virtual-bash"));
  assert.deepEqual(consumer, proof.consumerFiles);
  assert.equal(consumer.length, 709);
  assert.equal(hash(JSON.stringify(consumer)), pins.publicPackage.inventorySha256);
  const packageBytes = regular(join(pins.preparedRoot, "consumer/node_modules/virtual-bash/package.json"));
  assert.deepEqual(JSON.parse(packageBytes).exports, proof.packageExports);

  const engine = inventory(join(pins.preparedRoot, "engine"));
  const frozenEngine = Object.entries(snapshot.private.engine).map(([filename, entry]) => ({
    path: filename, bytes: entry.bytes, sha256: entry.sha256,
  })).sort(comparePaths);
  assert.deepEqual(engine, frozenEngine);
  assert.equal(engine.length, 264);
  assert.equal(hash(JSON.stringify(engine)), pins.privateEngine.copyInventorySha256);
  assert.equal(snapshot.private.head, pins.privateEngine.lastRecordedHead);
  assert.equal(hash(JSON.stringify(snapshot.private.engine)), pins.privateEngine.snapshotInventorySha256);
  assert.deepEqual(pins.privateEngine.staticImportClosure, proof.engine.staticImportClosure);
  for (const entry of pins.privateEngine.staticImportClosure) {
    assert.equal(engine.find(item => item.path === entry.path)?.sha256, entry.sha256, entry.path);
  }

  const tools = [];
  for (const entry of assembly.tooling) {
    const entries = inventory(join(pins.preparedRoot, "node_modules", entry.name));
    assert.deepEqual(entries, entry.files);
    const identity = { name: entry.name, version: entry.package, files: entries.length, inventorySha256: hash(JSON.stringify(entries)) };
    assert.deepEqual(identity, pins.tooling.packages.find(item => item.name === entry.name));
    tools.push(identity);
  }
  assert.equal(hash(regular(join(pins.preparedRoot, "loader.mjs"))), pins.tooling.loader.sha256);
  assert.equal(process.execPath, pins.tooling.node.path);
  assert.equal(process.version, pins.tooling.node.version);
  assert.equal(hash(regular(process.execPath)), pins.tooling.node.sha256);
  const resolution = JSON.parse(regular(join(owned, "TOOL-RESOLUTION.json")));
  for (const entry of pins.tooling.nativeReadTools) {
    if (entry.path !== resolution.alias) assert.equal(hash(regular(entry.path)), entry.sha256);
    else {
      assert.equal(entry.path, "/usr/bin/tar");
      assert.equal(resolution.canonical, "/usr/bin/bsdtar");
      assert.ok(lstatSync(entry.path).isSymbolicLink());
      assert.equal(readlinkSync(entry.path), resolution.linkText);
      assert.equal(realpathSync(entry.path), resolution.canonical);
      const bytes = regular(resolution.canonical);
      assert.equal(bytes.length, resolution.bytes);
      assert.equal(hash(bytes), resolution.sha256);
      assert.equal(resolution.sha256, entry.sha256);
    }
  }

  return {
    status: "STATIC_BYTES_MATCH_NOT_RUNTIME_ACCEPTANCE",
    at: new Date().toISOString(),
    reviewerThread: pins.reviewerThread,
    freezeSha256: hash(regular(join(owned, "FREEZE-v2.json"))),
    originalFreezeSha256: hash(regular(join(owned, "FREEZE.json"))),
    systemToolResolution: resolution,
    provenanceCommit: pins.provenance.commit,
    candidateEvidenceCommit: pins.candidate.evidenceCommit,
    candidateFiles: candidate.length,
    candidateInventorySha256: hash(JSON.stringify(candidate)),
    sourceFiles: 213,
    sourceManifestSha256: pins.candidate.sourceManifestSha256,
    compiledFiles: 708,
    compiledManifestSha256: pins.candidate.compiledManifestSha256,
    consumerFiles: consumer.length,
    consumerInventorySha256: hash(JSON.stringify(consumer)),
    engineCopiedFiles: engine.length,
    engineCopyInventorySha256: hash(JSON.stringify(engine)),
    staticEngineGraphFiles: pins.privateEngine.staticImportClosure.length,
    tools,
    inputs: { unconditionalCases: 8, conditionalCases: 1, guestBytesValidated: true, guestSyntaxValidated: false },
    execution: { guestCases: 0, privateEngineImports: 0, productRuntimeImports: 0, toolingImports: 0, builds: 0, installs: 0, privateCheckoutQueries: 0 },
    knownRemainingChildren: 0,
    qualification: "Builtin file/hash operations and bounded synchronous public Git reads only; private observations are prior sealed snapshots and regular copies, not fresh live-private verification. Receipt-review release remains pending.",
  };
}

try {
  process.stdout.write(JSON.stringify(verify(), null, 2) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "STATIC_PREPARATION_FAILED", at: new Date().toISOString(), error: String(error), stack: error.stack }, null, 2) + "\n");
  process.exitCode = 1;
}
