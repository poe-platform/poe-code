import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installGuard, assertClosedInputs } from './load-guard.mjs';

const grant = JSON.parse(readFileSync(new URL('./GRANT.json', import.meta.url), 'utf8'));
const template = JSON.parse(readFileSync(new URL('./GRANT.template.json', import.meta.url), 'utf8'));
if (JSON.stringify(Object.keys(grant)) !== JSON.stringify(Object.keys(template))) throw new Error('grant schema');
if (grant.authorized !== true || grant.phase !== 'worker' || grant.oneShot !== true || grant.runId !== 'RUN-WRQ-SYNC-V3-01' || grant.retries !== 0) throw new Error('fresh ROOT GO required');
for (const [field, path] of [['profileSha256', 'PROFILE.json'], ['caseSha256', 'CASES.json'], ['moduleSha256', 'MODULES.json'], ['toolSha256', 'TOOLS.json'], ['sourceSha256', 'SOURCES.json']]) {
  if (createHash('sha256').update(readFileSync(new URL('./' + path, import.meta.url))).digest('hex') !== grant[field]) throw new Error('grant body binding');
}
if (typeof grant.reviewCommit !== 'string' || !/^[a-f0-9]{40}$/.test(grant.reviewCommit) || grant.reviewDecision !== 'accept-exact-finite-recipe' || grant.compiler !== false) throw new Error('review/compiler role');
assertClosedInputs();
const loads = installGuard('parent');
const { executeCase } = await import('./supervisor.mjs');
const cases = JSON.parse(readFileSync(new URL('./CASES.json', import.meta.url), 'utf8')).instances;
if (!Array.isArray(grant.selectedInstances) || grant.selectedInstances.length > 11 || new Set(grant.selectedInstances).size !== grant.selectedInstances.length) throw new Error('finite selection');
const selected = grant.selectedInstances.map(identity => {
  const row = cases.find(candidate => candidate.instance === identity);
  if (!row || !row.candidateImplemented) throw new Error('held/unlisted instance');
  return row;
});
if (selected.reduce((sum, row) => sum + row.guestEvaluations, 0) > 10) throw new Error('guest ceiling');
const outputRoot = new URL('./runtime/RUN-WRQ-SYNC-V3-01/', import.meta.url);
mkdirSync(outputRoot, { recursive: true });
writeFileSync(new URL('CLAIM.json', outputRoot), JSON.stringify({ runId: grant.runId, sourceCommit: grant.sourceCommit }), { flag: 'wx' });
const admissionStarted = performance.now();
let capture = 0;
let session = 0;
for (const row of selected) {
  if (performance.now() - admissionStarted >= 120000) throw new Error('total admission clock closed');
  let cleanup;
  let result;
  try { result = await executeCase(row, ++session, callback => { cleanup = callback; }); }
  finally { if (cleanup) await cleanup(); }
  const bytes = Buffer.from(JSON.stringify(result.receipt) + '\n');
  capture += bytes.length;
  if (capture > 1048576) throw new Error('evidence aggregate cap');
  writeFileSync(new URL(row.instance + '.json', outputRoot), bytes, { flag: 'wx' });
  if (!result.receipt.facts.exited || !result.receipt.facts.cleanupClosed || result.receipt.status === 2) throw new Error('stop after unconfirmed/profile failure');
}
writeFileSync(new URL('LOADS.json', outputRoot), JSON.stringify(loads) + '\n', { flag: 'wx' });
