import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const owned = resolve(root, 'tests/stress/regex-execution/production-continuation-review');
const mode = process.argv[2];
if (!['baseline', 'candidate'].includes(mode)) throw new Error('explicit freeze mode required');
const target = resolve(owned, 'snapshots', mode);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const sourceRef = process.argv[3];
if (sourceRef && !/^[0-9a-f]{40}$/u.test(sourceRef)) throw new Error('exact immutable source commit required');
const worktreeHead = git('rev-parse', 'HEAD');
const head = sourceRef ?? worktreeHead;
const sources = new Map();
async function visit(path) {
  if (sources.has(path)) return;
  const bytes = sourceRef ? execFileSync('git', ['show', `${sourceRef}:${path}`], {cwd:root}) : await readFile(resolve(root, path));
  sources.set(path, bytes);
  if (!path.endsWith('.ts')) return;
  for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)["'](\.[^"']+\.js)["']/gu)) {
    await visit(relative(root, resolve(root, dirname(path), match[1].replace(/\.js$/u, '.ts'))));
  }
}
await visit('src/index.ts');
await visit('src/commands/regex-execution/worker.ts');
for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'AGENTS.md']) await visit(path);
const identities = [];
for (const [path, bytes] of [...sources].sort()) {
  await mkdir(dirname(resolve(target, path)), { recursive: true });
  await writeFile(resolve(target, path), bytes, { flag: 'wx' });
  const committed = hash(execFileSync('git', ['show', `${head}:${path}`], { cwd: root }));
  if (!sourceRef && hash(await readFile(resolve(root, path))) !== hash(bytes)) throw new Error(`source changed during freeze: ${path}`);
  identities.push({ path, sha256: hash(bytes), headSha256: committed, dirty: committed !== hash(bytes) });
}
const historical = [];
for (const path of git('ls-files', 'tests/stress/regex-execution/production-review').split('\n').filter(Boolean)) {
  historical.push({ path, sha256: hash(await readFile(resolve(root, path))) });
}
await mkdir(resolve(owned, 'evidence'), { recursive: true });
const manifest = { time: new Date().toISOString(), mode, head, worktreeHead, sourceRef:sourceRef??null, status: git('status', '--porcelain=v1'), index: git('diff', '--cached', '--name-status'), method: sourceRef ? 'Read static public src/index.ts relative closure plus worker graph directly with git show from exact author handoff commit. Exclude unrelated concurrent dirty FS sources. Per-file SHA256; ignored isolated snapshot build, never live dist.' : 'Byte copy of static public src/index.ts relative dependency closure and static worker graph; verify source unchanged while capturing. Immutable git HEAD plus per-file SHA256; ignored isolated snapshots used for build, never live dist.', profile: { node: process.version, platform: process.platform, arch: process.arch }, identities, historical };
await writeFile(resolve(owned, `evidence/${mode}-freeze.json`), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ mode, head, count: identities.length, dirty: identities.filter(item => item.dirty), historical: historical.length }));
