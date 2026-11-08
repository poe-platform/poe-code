import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const owned = resolve(root, 'tests/stress/regex-execution/production-review');
const mode = process.argv[2] ?? 'baseline';
const target = resolve(owned, 'snapshots', mode);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sources = new Map();
async function visit(path) {
  if (sources.has(path)) return;
  const bytes = await readFile(resolve(root, path));
  sources.set(path, bytes);
  if (!path.endsWith('.ts')) return;
  for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)["'](\.[^"']+\.js)["']/gu)) {
    await visit(relative(root, resolve(root, dirname(path), match[1].replace(/\.js$/u, '.ts'))));
  }
}
await visit('src/index.ts');
if (mode !== 'baseline') await visit('src/commands/regex-execution/worker.ts');
for (const path of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'package-lock.json', 'AGENTS.md']) await visit(path);
const identities = [];
for (const [path, bytes] of [...sources].sort()) {
  const destination = resolve(target, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
  let committed;
  try { committed = hash(execFileSync('git', ['show', `HEAD:${path}`], { cwd: root })); } catch { committed = null; }
  identities.push({ path, sha256: hash(bytes), headSha256: committed, dirty: committed !== hash(bytes) });
}
const historical = [];
if (mode === 'baseline') {
  for (const path of git('ls-files', 'tests/stress/regex-execution').split('\n').filter(path => path && !path.includes('/production-review/'))) {
    const bytes = await readFile(resolve(root, path));
    historical.push({ path, sha256: hash(bytes) });
  }
  execFileSync('tar', ['-czf', resolve(owned, 'prior-evidence.tgz'), ...historical.map(item => item.path)], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
}
const manifest = { time: new Date().toISOString(), mode, head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1'), index: git('diff', '--cached', '--name-status'), root, snapshot: target, profile: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch }, consumedClosure: 'Static relative imports/exports from public src/index.ts, plus adjacent static worker URLs. Other-owner runtime/parser captured as consumed, never edited.', identities, historical, historicalArchiveSha256: mode === 'baseline' ? hash(await readFile(resolve(owned, 'prior-evidence.tgz'))) : null };
await mkdir(resolve(owned, 'evidence'), { recursive: true });
await writeFile(resolve(owned, `evidence/${mode}-freeze.json`), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ mode, entries: identities.length, dirty: identities.filter(entry => entry.dirty), snapshot: target }));
