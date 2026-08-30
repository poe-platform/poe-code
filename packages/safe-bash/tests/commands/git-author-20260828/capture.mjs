import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const demand = (value, message) => { if (!value) throw new Error(message); };
const ids = ['Y7xesb', 'OkThoJ', 'aXLolh', 'BBy2Bv', 'QeOTUt', 'Dq7gbv'];
const attempts = [];
let captured = 0;
for (const id of ids) {
  const root = path.join(os.tmpdir(), 'git-m1a-author-' + id);
  const files = [];
  for (const name of (await fs.readdir(root)).sort()) {
    const target = path.join(root, name), stat = await fs.lstat(target);
    if (!stat.isFile()) continue;
    demand(name !== 'AGENTS.md' && stat.size <= 8 * 1024 * 1024, 'capture input cap');
    const bytes = await fs.readFile(target);
    const descriptor = { name, bytes: bytes.length, sha256: sha(bytes) };
    if (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.stdout') || name.endsWith('.stderr')) {
      if (!name.includes('development-exact-blobs.stdout')) { captured += bytes.length; demand(captured < 64 * 1024 * 1024, 'capture aggregate cap'); descriptor.base64 = bytes.toString('base64'); }
      else descriptor.omission = 'Exact source bytes already authenticated by Git blob and SHA256 rows; retained original raw file not copied redundantly';
      files.push(descriptor);
    }
  }
  attempts.push({ id, root, result: JSON.parse(await fs.readFile(path.join(root, 'RESULT.json'))), files });
}
const final = attempts.at(-1).result;
demand(final.status === 'AUTHOR_SCOPED_PASS', 'not final pass');
const baseEncoded = await fs.readFile(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
demand(sha(baseEncoded) === 'a49b8a7055ac2902d1368ddb638d62c5a1896dc9ed25c18b025816a710077509', 'base evidence binding');
const base = JSON.parse(gunzipSync(Buffer.from(baseEncoded.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }));
const current = new Map(final.packageFiles.map(row => [row.path, row]));
let unchanged = 0;
for (const [name, row] of Object.entries(base.fullInstalledBefore)) {
  if (row.kind !== 'file') continue;
  const actual = current.get(name);
  demand(actual && actual.bytes === row.bytes && actual.mode === row.mode && actual.sha256 === row.sha256, `base package changed ${name}`);
  current.delete(name); unchanged++;
}
demand(unchanged === 858 && current.size === 40 && [...current.keys()].every(name => name.startsWith('dist/commands/git/')), 'full package composition');
const moduleRows = [];
for (const row of final.moduleInputs) {
  const bytes = await fs.readFile(path.join(repo, 'src/commands/git', row.path));
  demand(bytes.length === row.bytes && sha(bytes) === row.sha256, 'committed module drift');
  moduleRows.push({ ...row, path: 'src/commands/git/' + row.path, blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
}
const packageRoot = path.join(final.output, 'moved package/node_modules/virtual-bash');
for (const row of final.packageFiles) {
  const bytes = await fs.readFile(path.join(packageRoot, row.path));
  demand(sha(bytes) === row.sha256, 'moved package drift');
}
const packName = JSON.parse(await fs.readFile(path.join(final.output, '5-pack.stdout')))[0].filename;
const tarball = await fs.readFile(path.join(final.output, 'source', packName));
demand(sha(tarball) === final.packageSha256, 'tarball drift');
const raw = { schema: 'git-m1a-author-evidence-v1', date: '2026-08-28', attempts, basePackageUnchanged: unchanged, addedFiles: [...current.values()], moduleRows };
const rawBytes = Buffer.from(JSON.stringify(raw)), packed = gzipSync(rawBytes), encoded = Buffer.from(packed.toString('base64') + '\n');
const resultDirectory = path.join(here, 'results-v1'); await fs.mkdir(resultDirectory);
await fs.writeFile(path.join(resultDirectory, 'RAW.json.gz.base64'), encoded, { flag: 'wx' });
await fs.writeFile(path.join(resultDirectory, 'PACKAGE.tgz.base64'), tarball.toString('base64') + '\n', { flag: 'wx' });
const candidate = { schema: 'git-m1a-isolated-input-composition-v1', date: '2026-08-28', sourceCommit: '9885390fb11454fa194a3e60fdbef198dbfdf633', base: final.base,
  productCommitClaim: 'No combined stored commit claimed: accepted coherent78 selected source closure plus ONLY the11 listed new module paths',
  baseEvidenceEncodedSha256: sha(baseEncoded), selectedBaseInputs: final.baseInputs, moduleInputs: moduleRows,
  sourceManifestSha256: final.sourceManifestSha256, packageSha256: final.packageSha256, packageBytes: tarball.length,
  packageFileCount: final.packageFiles.length, baseCommonFilesByteModeEqual: unchanged, onlyAddedPackageFiles: [...current.values()],
  unchangedRootFiles: final.baseInputs.filter(row => ['src/index.ts', 'src/plugins/index.ts', 'package.json', 'README.md'].includes(row.path)),
  raw: { file: 'RAW.json.gz.base64', rawBytes: rawBytes.length, rawSha256: sha(rawBytes), gzipSha256: sha(packed), encodedSha256: sha(encoded) },
  nodeVersion: 'v22.22.2', nodeSha256: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011',
  outcome: { source: [140, 0], compiled: [140, 0], installed: [140, 0], moved: [140, 0], strictTypes: 'PASS including4negative directives', loadedMutantsDetected: 3, bindingRefusals: 3, observedUniqueProductModulesPerLayout: 220, directSupervisedChildren: 15, allClosed: final.children.every(child => child.closed), nativeGitOracleExecutions: 0 },
  qualification: 'Author scoped completion pending DIFFERENT review; no root/subpath/default registration, no M1B or native parity. Counter tests are not full numeric/RSS boundaries; source selected input proof is not complete Git archive reconstruction.' };
await fs.writeFile(path.join(resultDirectory, 'CANDIDATE.json'), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ rawSha256: sha(rawBytes), encodedSha256: sha(encoded), packageSha256: final.packageSha256, packageBytes: tarball.length, baseCommon: unchanged, added: current.size }));
