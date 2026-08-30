import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HERE, sha, need, now, put } from './common.mjs';

const binding = JSON.parse(await fs.readFile(path.join(HERE, 'BINDING.json')));
const preseal = JSON.parse(await fs.readFile(path.join(HERE, 'PRESEAL.json')));
const audit = JSON.parse(await fs.readFile(path.join(HERE, 'AUDIT.json')));
for (const row of preseal.files) need(sha(await fs.readFile(path.join(HERE, row.path))) === row.sha256, 'preseal remains immutable');
for (const archive of Object.values(audit.archives)) {
  const encoded = await fs.readFile(path.join(HERE, archive.file));
  need(sha(encoded) === archive.encodedSha256, 'final encoded archive hash');
  const compressed = Buffer.from(encoded.toString().trim(), 'base64');
  need(sha(compressed) === archive.gzipSha256, 'final gzip hash');
  const decoded = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  need(sha(decoded) === archive.decodedSha256, 'final decoded archive hash');
  for (const row of JSON.parse(decoded).entries) if (!row.directory) need(sha(Buffer.from(row.base64, 'base64')) === row.sha256, 'final every archived member hash');
}
const names = (await fs.readdir(HERE)).sort();
const files = [];
for (const name of names) {
  const stat = await fs.lstat(path.join(HERE, name)); need(stat.isFile() && !stat.isSymbolicLink(), 'no staging trees/instruction copies remain');
  const bytes = await fs.readFile(path.join(HERE, name)); files.push({ path: name, bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha(bytes) });
}
const final = { schema: 'different-m1a-v5-final-evidence-seal', status: 'PARTIAL_ACTUAL_REVIEW_SAFETY_STOP_NO_RETRY', date: new Date().toISOString(), source: binding.source, evidence: binding.evidence, base: binding.base, presealCommit: audit.presealCommit, files,
  sourceRows: { planned: 71, captured: 69, assertionPass: 69, assertionFail: 0, lifecycleStop: 'H09', unexecuted: ['H10', 'H11'] }, otherLayoutsTypesMutantsBindings: 'UNRUN', nativeGit: 'UNRUN', M1B: 'UNRUN',
  measuredPreparationThroughFinalSealMs: now() - binding.startMonotonicMs, priorInspectionReserveMs: binding.priorInspectionReserveMs, accountedThroughFinalSealMs: now() - binding.startMonotonicMs + binding.priorInspectionReserveMs, aggregateLimitMs: 6600000 };
need(now() < binding.measuredDeadlineMs && final.accountedThroughFinalSealMs < final.aggregateLimitMs, 'final publication inside original deadline');
await put(path.join(HERE, 'FINAL-SEAL.json'), JSON.stringify(final, null, 2) + '\n');
console.log(JSON.stringify({ status: final.status, files: files.length, accountedMs: final.accountedThroughFinalSealMs, handoff: path.join(HERE, 'HANDOFF.md') }));
