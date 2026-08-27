import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const surface = dirname(owned);
const repository = resolve(surface, "../../../..");
const prefix = relative(repository, surface) + "/";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sortPaths = (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
const bindings = [];

function regular(filename) {
  assert.equal(realpathSync(filename), filename, `Symlink component: ${filename}`);
  assert.ok(lstatSync(filename).isFile(), filename);
  return readFileSync(filename);
}

function pinned(commit, filename) {
  const bytes = execFileSync("/usr/bin/git", ["-C", repository, "show", `${commit}:${filename}`], {
    env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    timeout: 20000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.deepEqual(regular(join(repository, filename)), bytes, filename);
  bindings.push({ commit, path: filename, bytes: bytes.length, sha256: hash(bytes) });
  return bytes;
}

function inventory(root) {
  assert.equal(realpathSync(root), root);
  const files = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), filename);
      if (stat.isDirectory()) visit(filename);
      else {
        const bytes = regular(filename);
        files.push({ path: relative(root, filename), bytes: bytes.length, sha256: hash(bytes),
          mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
      }
    }
  }
  visit(root);
  return files.sort(sortPaths);
}

const bytesOnly = entries => entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
const inputCommit = "5645b4f516438b66e4fad32a585ab27cda8f7cdc";
const runnerCommit = "5d2c2f93d794b2a52d56ee503119052a5fefe1fd";
const evidenceCommit = "b0ff1977c9c912054edd136510d62819d28cf890";
const pins = JSON.parse(pinned(inputCommit, prefix + "PINS.json"));
const cases = JSON.parse(pinned(inputCommit, prefix + "CASES.json"));
const freeze = JSON.parse(pinned(inputCommit, prefix + "FREEZE-v2.json"));
for (const entry of freeze.files) assert.equal(hash(regular(join(surface, entry.path))), entry.sha256);
for (const name of ["child.mjs", "run.mjs", "RELEASE.json", "RUNNER-FREEZE.json"]) pinned(runnerCommit, prefix + "execution-v1/" + name);
const rawPrefix = prefix + "execution-v1/attempt-01/raw/";
const capture = JSON.parse(pinned(evidenceCommit, prefix + "execution-v1/attempt-01/CAPTURE-MANIFEST.json"));
for (const entry of capture.files) assert.equal(hash(regular(join(repository, rawPrefix, entry.path))), entry.sha256, entry.path);
const journal = JSON.parse(pinned(evidenceCommit, rawPrefix + "journal.json"));
const copies = JSON.parse(pinned(evidenceCommit, rawPrefix + "copy-provenance.json"));
assert.deepEqual(journal.counts, { executed: 8, pass: 7, fail: 1, invalid: 0, blocked: 0, conditionalExecuted: 0 });
const provenance = new Map();
for (const entry of pins.provenance.files) {
  const bytes = pinned(pins.provenance.commit, entry.path);
  assert.equal(hash(bytes), entry.sha256);
  provenance.set(entry.name, JSON.parse(bytes));
}
const assembly = provenance.get("assembly.json");
const build = provenance.get("build-proof.json");
const expectedEngine = copies.find(entry => entry.destination === "engine");
assert.ok(expectedEngine);
const roots = {
  candidate: join(pins.preparedRoot, "candidate"),
  consumer: join(pins.preparedRoot, "consumer/node_modules/virtual-bash"),
  engine: join(pins.preparedRoot, "engine"),
};
const before = Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, inventory(root)]));
assert.deepEqual(bytesOnly(before.candidate), assembly.candidateFiles);
assert.deepEqual(bytesOnly(before.consumer), build.consumerFiles);
assert.deepEqual(bytesOnly(before.engine), expectedEngine.entries);
assert.equal(before.candidate.length, 940);
assert.equal(before.consumer.length, 709);
assert.equal(before.engine.length, 264);
const caseFacts = [];
const imported = new Map();
for (const id of ["07-reflection-profile", "08-function-spread-profile"]) {
  const selected = cases.cases.find(entry => entry.id === id);
  pinned(inputCommit, prefix + selected.source.path);
  const actual = JSON.parse(pinned(evidenceCommit, rawPrefix + id + "/actual.json"));
  const assessment = JSON.parse(pinned(evidenceCommit, rawPrefix + id + "/assessment.json"));
  const child = JSON.parse(pinned(evidenceCommit, rawPrefix + id + "/child.json"));
  const imports = pinned(evidenceCommit, rawPrefix + id + "/imports.ndjson").toString().trim().split("\n").map(line => JSON.parse(line));
  imported.set(id, imports);
  assert.equal(hash(Buffer.from(actual.source.exactText)), selected.source.sha256);
  assert.deepEqual(actual.hostFindings, []);
  assert.deepEqual(actual.cleanupFailures, []);
  assert.deepEqual(actual.hostCounters, selected.expected.hostCounters);
  const publicNames = ["shell rejection", "exit code", "stdout", "stderr", "collected accounted output", "VFS bytes and complete namespace", "cleanup failures", "host callback counters"];
  assert.ok(publicNames.every(name => assessment.checks.find(entry => entry.name === name)?.pass));
  caseFacts.push({ id, expected: selected.expected, source: selected.source,
    rawOutcome: assessment.outcome, publicChecks: assessment.checks.filter(entry => publicNames.includes(entry.name)),
    failedChecks: assessment.checks.filter(entry => !entry.pass), actual: {
      engineFieldPresent: Object.hasOwn(actual, "engine"), engine: actual.engine ?? null,
      outerFailureFieldPresent: Object.hasOwn(actual, "failure"), shell: actual.shell,
      events: actual.events, hostCounters: actual.hostCounters, runtimeCalls: actual.runtimeCalls,
      cleanupFailures: actual.cleanupFailures, hostFindings: actual.hostFindings,
      collectedStdout: actual.collectedStdout, vfsUnchanged: JSON.stringify(actual.vfsBefore) === JSON.stringify(actual.vfsAfter),
    }, child: { pid: child.pid, code: child.code, signal: child.signal, timedOut: child.timedOut, closed: child.closed, parentAfter: child.parentAfter } });
}
const productPaths = ["package.json", "src/index.ts", "src/contracts/io.ts", "src/contracts/output.ts", "src/contracts/command.ts", "src/contracts/command.md",
  "src/commands/safejs/index.ts", "src/commands/safejs/types.ts", "src/commands/safejs/README.md", "src/integrations/safejs/values.ts",
  "dist/contracts/output.d.ts", "dist/contracts/io.d.ts", "dist/contracts/command.d.ts", "dist/commands/safejs/types.d.ts",
  "dist/commands/safejs/index.js", "dist/integrations/safejs/values.js"];
const enginePaths = ["src/run.ts", "src/interp/interpreter.ts", "src/interp/globals/object-array.ts", "src/interp/methods/function.ts", "src/interp/host-bridge.ts"];
const selectedSources = [];
for (const [rootName, paths] of [["candidate", productPaths], ["engine", enginePaths]]) {
  for (const path of paths) {
    const entry = before[rootName].find(item => item.path === path);
    assert.ok(entry, path);
    const originalImportPath = rootName === "engine" ? "engine/" + path : path.startsWith("dist/") && path.endsWith(".js") ? "consumer/node_modules/virtual-bash/" + path : null;
    const originalImports = originalImportPath ? Object.fromEntries([...imported].map(([id, entries]) => {
      const importedEntry = entries.find(item => item.path === originalImportPath);
      assert.equal(importedEntry?.sha256, entry.sha256, originalImportPath);
      return [id, { path: importedEntry.path, sha256: importedEntry.sha256 }];
    })) : null;
    if (path.startsWith("dist/")) assert.equal(before.consumer.find(item => item.path === path)?.sha256, entry.sha256);
    selectedSources.push({ scope: rootName, path, existingRegularCopy: join(roots[rootName], path), bytes: entry.bytes, sha256: entry.sha256, originalImports });
  }
}
const after = Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, inventory(root)]));
assert.deepEqual(after, before);
process.stdout.write(JSON.stringify({ at: new Date().toISOString(), status: "AUTHENTICATED_READONLY_PROPOSAL_INPUTS",
  originalSurfaceAuthorReviewerThread: "01a04292-5421-7363-8bcb-a70b97fae4e9",
  proposalAuthorThread: "01a04292-5421-7363-8bcb-a70b97fae4e9", independentSignedReviewProvided: false,
  inputCommit, runnerCommit, evidenceCommit, bindings, originalRawCounts: journal.counts,
  candidate: { evidenceCommit: pins.candidate.evidenceCommit, sourceManifestSha256: pins.candidate.sourceManifestSha256,
    compiledManifestSha256: pins.candidate.compiledManifestSha256, archiveSha256: pins.candidate.archive.sha256 },
  retainedRoots: Object.fromEntries(Object.entries(before).map(([name, entries]) => [name, { path: roots[name], files: entries.length,
    byteInventorySha256: hash(JSON.stringify(bytesOnly(entries))), metadataInventorySha256: hash(JSON.stringify(entries)), fullBeforeAfterEqual: true, newEntriesDetected: true }])),
  originalPrivateSourceOrigin: expectedEngine.source, originalRunPrivateHead: pins.privateEngine.lastRecordedHead,
  currentPrivateCheckoutQueried: false, currentPrivateCheckoutClaim: "None; only the existing regular copy authenticated against the original actual-run copy/import evidence was read",
  selectedSources, caseFacts, execution: { guests: 0, runtimeImports: 0, productImports: 0, privateImports: 0, builds: 0, installs: 0 },
  retainedDiscoveryMistake: "A read-only lookup for candidate/src/integrations/safejs/README.md returned ENOENT; that file does not exist. Actual commands/safejs/README.md and integration source/declarations were used. No runtime attempt resulted.",
}, null, 2) + "\n");
