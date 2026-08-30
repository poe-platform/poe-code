import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HERE, REPO, SOURCE, EVIDENCE, sha, objectHash, need, now, inventory, put, untar } from './common.mjs';

const start = now();
const git = args => execFileSync('/usr/bin/git', args, { cwd: REPO, maxBuffer: 16 * 1024 * 1024, timeout: 15000, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' } });
const candidatePath = 'tests/commands/git-author-20260828/results-v1/CANDIDATE.json';
const receiptBytes = git(['show', `${EVIDENCE}:${candidatePath}`]);
const candidate = JSON.parse(receiptBytes);
need(candidate.sourceCommit === SOURCE && candidate.base === '8437e4eda904e1248c25eeef0d9d455b1d251495', 'exact receipt base, not count');
const commits = [SOURCE, EVIDENCE, '12e943bd3664a2f8286fc3063542877ae7f56a8e', '70ba55eaaa705307eec5b985fc3d8963f6764159'];
for (const commit of commits) need(objectHash('commit', git(['cat-file', 'commit', commit])) === commit, 'stored commit identity');
const baseEncoded = await fs.readFile(path.join(REPO, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
need(sha(baseEncoded) === candidate.baseEvidenceEncodedSha256, 'authenticated accepted base evidence');
const base = JSON.parse(gunzipSync(Buffer.from(baseEncoded.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }));
assert.deepEqual(base.source.inputs, candidate.selectedBaseInputs);
for (const row of base.source.commits) need(objectHash('commit', Buffer.from(row.base64, 'base64')) === row.revision && git(['cat-file', 'commit', row.revision]).equals(Buffer.from(row.base64, 'base64')), 'base stored commit');
const trees = new Map();
for (const row of [...base.source.reachableTrees, ...base.source.reconstructedTrees]) {
  const bytes = Buffer.from(row.base64, 'base64');
  need(objectHash('tree', bytes) === row.oid, 'canonical tree byte identity');
  const entries = []; let offset = 0;
  while (offset < bytes.length) { const space = bytes.indexOf(32, offset), zero = bytes.indexOf(0, space); entries.push({ mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex') }); offset = zero + 21; }
  trees.set(row.oid, entries);
}
const editTree = (oid, parts, row) => {
  const entries = structuredClone(trees.get(oid)); need(entries, 'authenticated traversed base tree');
  const entry = entries.find(item => item.name === parts[0]); need(entry, 'component existing path');
  if (parts.length === 1) { entry.oid = row.blob; entry.mode = row.mode; }
  else entry.oid = editTree(entry.oid, parts.slice(1), row);
  const bytes = Buffer.concat(entries.map(item => Buffer.concat([Buffer.from(`${item.mode} ${item.name}\0`), Buffer.from(item.oid, 'hex')])));
  const result = objectHash('tree', bytes); trees.set(result, entries); return result;
};
let composition = base.source.commits[0].tree;
for (const row of base.source.componentTable) composition = editTree(composition, row.path.split('/'), row);
need(composition === candidate.base, 'recomputed derived base identity; no stored-object requirement');
const selected = [...candidate.selectedBaseInputs, ...candidate.moduleInputs];
need(candidate.selectedBaseInputs.length === 268 && candidate.moduleInputs.length === 11, '268+11 selected inputs');
const revisions = new Map();
const payload = [];
for (const row of selected) {
  const revision = row.revision ?? SOURCE;
  if (!revisions.has(revision)) revisions.set(revision, git(['ls-tree', '-r', revision]).toString());
  const mode = typeof row.mode === 'number' ? '100' + row.mode.toString(8) : row.mode;
  need(revisions.get(revision).split('\n').includes(`${mode} blob ${row.blob}\t${row.path}`), `stored membership ${row.path}`);
  const bytes = git(['cat-file', 'blob', row.blob]);
  need(bytes.length === row.bytes && sha(bytes) === row.sha256 && objectHash('blob', bytes) === row.blob, `blob ${row.path}`);
  payload.push({ path: row.path, mode: typeof row.mode === 'number' ? row.mode : Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256, base64: bytes.toString('base64') });
}
const packageEncoded = git(['show', `${EVIDENCE}:tests/commands/git-author-20260828/results-v1/PACKAGE.tgz.base64`]);
const packageBytes = Buffer.from(packageEncoded.toString(), 'base64');
need(sha(packageBytes) === '68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68', 'full898 package hash');
const members = untar(gunzipSync(packageBytes, { maxOutputLength: 32 * 1024 * 1024 }));
need(members.length === 898, 'full898 package inventory');
let unchanged = 0;
for (const [name, row] of Object.entries(base.fullInstalledBefore)) {
  if (row.kind !== 'file') continue;
  const member = members.find(item => item.path === name);
  need(member && member.data.length === row.bytes && member.mode === row.mode && sha(member.data) === row.sha256, `base858 member ${name}`); unchanged++;
}
need(unchanged === 858, 'all858 unchanged baseline members');
const tools = [];
for (const name of ['typescript', '@types/node', 'undici-types']) {
  const root = await fs.realpath(path.join(REPO, 'node_modules', name));
  const rows = await inventory(root);
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version;
  need(version === ({ typescript: '5.9.3', '@types/node': '22.20.1', 'undici-types': '6.21.0' })[name], 'locked tool version');
  tools.push({ name, root, version, rows });
}
const recordsPath = path.join(REPO, 'tests/commands/git-independent-20260828/preparation-v3/records.json');
const records = await fs.readFile(recordsPath);
const parsedRecords = JSON.parse(records);
need(sha(Buffer.from(parsedRecords.records.supervisor.base64, 'base64')) === '3e624d9dd62d30a134540078a0ee3df4b8fdbd16d3f817c75f9583ba60dbcd08', 'known H11 source; inert only');
const declarations = members.filter(row => /(?:commands\/git\/index|contracts\/command|contracts\/plugin)\.d\.ts$/.test(row.path)).map(row => ({ path: row.path, text: row.data.toString(), sha256: sha(row.data) }));
const plan = {
  schema: 'different-m1a-v5-binding', date: '2026-08-28', startMonotonicMs: start, startWall: new Date().toISOString(),
  priorInspectionReserveMs: 1800000, measuredDeadlineMs: start + 4800000, aggregateCeilingMs: 6600000,
  source: SOURCE, evidence: EVIDENCE, base: candidate.base, receiptSha256: sha(receiptBytes), selected,
  packageSha256: sha(packageBytes), packageBytes: packageBytes.length,
  members: members.map(({ data, ...row }) => ({ ...row, bytes: data.length, sha256: sha(data) })),
  declarations, tools, node: { path: process.execPath, version: process.version, sha256: sha(await fs.readFile(process.execPath)) },
  lock: { sha256: sha(await fs.readFile(path.join(REPO, 'package-lock.json'))), bytes: (await fs.stat(path.join(REPO, 'package-lock.json'))).size },
  records: { path: recordsPath, sha256: sha(records) },
  resourcePolicy: { maxProcesses: 4, targetProcesses: 2, loaderThreadsPerChild: 1, libuvThreadsPerChild: 1, sequentialNativeZlibPerCase: 1, maxCapture: 134217728, maxWorking: 536870912, caseMs: 30000, buildMs: 120000, cleanupReserveMs: 5000 },
  installation: 'verified manual staging of actual full898 author tar payload; NOT npm install/pack claim',
  sourceLoader: 'authenticated TypeScript5.9.3 transpileModule in Node ESM loader, not tsx or VM product emulation',
  processIdentity: 'detached Node owned child handle plus IPC pid/monotonic birth handshake and assigned PGID=pid; no native observer, no OS birth census claim',
  toolPolicy: 'read-only full inventories reused in original location, not copied or charged as newly staged bytes; no npm or networking',
  native: 'zero native Git/version/oracle/native-bridge/H11 executions; static H11 source authentication only',
};
await put(path.join(HERE, 'BINDING.json'), JSON.stringify(plan, null, 2) + '\n');
await put(path.join(HERE, 'INPUTS.json'), JSON.stringify(payload) + '\n');
console.log(JSON.stringify({ selected: selected.length, packageMembers: members.length, tools: tools.map(row => [row.name, row.rows.length]), declarationBindings: declarations, deadline: plan.measuredDeadlineMs }));
