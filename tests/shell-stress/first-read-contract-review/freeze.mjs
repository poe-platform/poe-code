import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = process.cwd();
const owned = resolve(root, 'tests/shell-stress/first-read-contract-review');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = git('ls-files', '-z').split('\0').filter(Boolean).filter(path =>
  path.startsWith('src/') || path.startsWith('tests/') ||
  /(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|AGENTS\.md)$/.test(path));
const manifest = paths.map(path => {
  try { const bytes = readFileSync(path); return { path, bytes: bytes.length, sha256: hash(bytes) }; }
  catch (error) { return { path, error: String(error) }; }
});
const snapshot = {
  frozenAt: new Date().toISOString(), root, head: git('rev-parse', 'HEAD').trim(),
  status: git('status', '--porcelain=v2', '--untracked-files=all'),
  index: git('ls-files', '--stage'), trackedDiff: git('diff', '--binary'),
  stagedDiff: git('diff', '--cached', '--binary'),
  node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
  manifest, manifestSha256: hash(JSON.stringify(manifest)),
  intentSha256: hash(readFileSync(resolve(owned, 'INTENT.md'))),
  classification: 'Tracked inputs hashed as bytes only; no foreign holdout body inspected. Original/native capture data is not newly canonical TypeScript.'
};
mkdirSync(resolve(owned, 'evidence'), { recursive: true });
writeFileSync(resolve(owned, 'evidence/freeze.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
const candidate = resolve(owned, '.scratch/candidate');
mkdirSync(candidate, { recursive: true });
cpSync(resolve(root, 'src'), resolve(candidate, 'src'), { recursive: true });
for (const path of ['package.json', 'package-lock.json', 'tsconfig.json']) cpSync(resolve(root, path), resolve(candidate, path));
for (const item of manifest.filter(item => item.path.startsWith('src/'))) {
  if (hash(readFileSync(resolve(candidate, item.path))) !== item.sha256) throw new Error(`Source changed during pin: ${item.path}`);
}
const proof = { candidate, sourceFileCount: manifest.filter(item => item.path.startsWith('src/')).length, sourceManifestSha256: hash(JSON.stringify(manifest.filter(item => item.path.startsWith('src/')))), copiedAt: new Date().toISOString(), sourceVerified: true };
writeFileSync(resolve(owned, 'evidence/source-copy.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ head: snapshot.head, manifestSha256: snapshot.manifestSha256, ...proof }, null, 2));
