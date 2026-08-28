import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { scope, raw, read, save, hash, fileHash, inventory, authenticateProtected, authenticateRecipe } from './recipe/common.mjs';

const recipeCommit = '9aefcb0adc423636c3667731266c694598b281ab';
const recipeProof = authenticateRecipe(recipeCommit);
const result = read(join(scope, 'RESULT.json'));
assert.equal(result.status, 'PREREQUISITES-75-PASS');
assert.equal(result.summary.outcomes.length, 75);
assert.equal(result.realResourceCasesReplayed, 0);
const snapshot = inventory(raw);
save(join(scope, 'RAW-INVENTORY.json'), { schema: 'html-prerequisite-raw/1', ...snapshot });
const archive = join(scope, 'captures.jsonl.gz');
async function* lines() {
  for (const [relative, identity] of Object.entries(snapshot.files)) {
    const bytes = fs.readFileSync(join(raw, relative));
    assert.equal(hash(bytes), identity.sha256);
    yield `${JSON.stringify({ path: relative, ...identity, base64: bytes.toString('base64') })}\n`;
  }
}
await pipeline(Readable.from(lines()), createGzip({ level: 9 }), fs.createWriteStream(archive, { flags: 'wx' }));
const archiveDescriptor = fs.openSync(archive, 'r+');
try { fs.fsyncSync(archiveDescriptor); } finally { fs.closeSync(archiveDescriptor); }
const decompressed = fs.createReadStream(archive).pipe(createGunzip());
const reader = createInterface({ input: decompressed, crlfDelay: Infinity });
const verified = {};
for await (const line of reader) {
  const entry = JSON.parse(line);
  assert.ok(Object.hasOwn(snapshot.files, entry.path));
  assert.equal(Object.hasOwn(verified, entry.path), false);
  const bytes = Buffer.from(entry.base64, 'base64');
  verified[entry.path] = { sha256: hash(bytes), bytes: bytes.length };
  assert.deepEqual(verified[entry.path], snapshot.files[entry.path]);
}
assert.deepEqual(verified, snapshot.files);
assert.deepEqual(inventory(raw), snapshot);
save(join(scope, 'COMPACTION.json'), { at: new Date().toISOString(), archive: 'captures.jsonl.gz', schema: 'one JSON record per original raw file, base64 bytes; directories in RAW-INVENTORY.json', sha256: fileHash(archive), bytes: fs.statSync(archive).size, verifiedFiles: Object.keys(verified).length, verifiedDirectories: snapshot.directories.length, originalBytes: Object.values(snapshot.files).reduce((total, entry) => total + entry.bytes, 0), allOriginalFilesEqualBeforeRemoval: true, caseExecutions: 0, retries: 0 });
fs.rmSync(raw, { recursive: true });
assert.equal(fs.existsSync(raw), false);
const final = await authenticateProtected();
save(join(scope, 'FINAL-AUTH.json'), final);
save(join(scope, 'CLEANUP.json'), { at: new Date().toISOString(), rawRemovedAfterCompleteArchiveVerification: true, runtimeStreamsAwaited: true, completedOriginalRunProbe: result.probe, stalePidLeaseClaim: false, watchdogSignals: result.signals, childStatuses: result.processes.map(row => ({ pid: row.childPid, exit: row.exit, close: row.close, signals: row.signals })), subsequentCaseExecutions: 0 });
assert.deepEqual(authenticateRecipe(recipeCommit), recipeProof);
const complete = inventory(scope);
const manifest = { schema: 'html-v32-prerequisite-completion-evidence/1', at: new Date().toISOString(), recipe: recipeProof, status: result.status, actual: { consumer: 28, forwarding: 6, ordered: 8, originalReadonly: 33, total: 75, expected: 75, unexpected: 0, unexecuted: 0, invocation: 1, retry: false, realResourceReplays: 0 }, rawFiles: Object.keys(verified).length, processQualification: { forwardingSubjects: 8, readonlyChild: 1, coordinator: 1, observedAbsentPids: result.probe.pids.length, observedEmptyGroups: result.probe.groups.length, synchronousToolReturns: result.synchronous.returned, synchronousPsCloses: result.synchronous.spawnSyncClosed }, actualUntransformedModuleLoads: result.loads.length, uniqueLoadedFiles: new Set(result.loads.map(row => row.url)).size, protected: { independentFiles: final.protectedIndependentFiles, authorFiles: final.authorFiles, priorFiles: final.priorFiles }, files: complete.files, directories: complete.directories, coveredFiles: Object.keys(complete.files).length, composition: read(join(scope, 'recipe/BINDINGS.json')).composition, compositionQualification: 'completes omitted prerequisites only; not a single unchanged original invocation, public acceptance or historical rescore', html34Executed: 0, du29Executed: 0 };
save(join(scope, 'EVIDENCE-MANIFEST.json'), manifest);
console.log(JSON.stringify({ status: manifest.status, evidenceManifestSha256: fileHash(join(scope, 'EVIDENCE-MANIFEST.json')), coveredFiles: manifest.coveredFiles, rawFiles: manifest.rawFiles, archiveSha256: fileHash(archive), archiveBytes: fs.statSync(archive).size, cleanup: true }));
