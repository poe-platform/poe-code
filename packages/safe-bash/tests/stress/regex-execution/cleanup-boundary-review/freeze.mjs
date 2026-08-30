import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const owned = 'tests/stress/regex-execution/cleanup-boundary-review';
const [label, commit, mode = 'full'] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]*$/u.test(label ?? '') || !/^[a-f0-9]{40}$/u.test(commit ?? '')) throw new Error('label and exact commit required');
if (!['full', 'registration-overlay', 'runtime-handoff'].includes(mode)) throw new Error('invalid freeze mode');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const base = '07acb1a4d30b7592cf247a0220250317be4e2038';
const sourceCommit = mode === 'registration-overlay' ? base : commit;
const overlayPaths = ['src/commands/grep.ts', 'src/commands/search/rg.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/README.md'];
let handoff;
if (mode !== 'full') {
  const path = mode === 'registration-overlay' ? '/tmp/regex-cleanup-author-ready.txt' : '/tmp/regex-cleanup-runtime-ready.txt';
  const contents = await readFile(path, 'utf8');
  if (!contents.includes(commit) && !contents.includes(commit.slice(0, 7))) throw new Error('handoff does not identify requested commit');
  handoff = { path, contents, sha256: sha256(contents) };
}
const paths = [...git('ls-tree', '-r', '--name-only', sourceCommit, 'src').toString().trim().split('\n'), 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const identities = [];
for (const path of paths) {
  const ref = mode === 'registration-overlay' && overlayPaths.includes(path) ? commit : sourceCommit;
  const bytes = git('show', `${ref}:${path}`);
  const target = resolve(owned, '.temporary', label, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  identities.push({ path, sha256: sha256(bytes), commit: ref });
}
const prior = 'tests/stress/regex-execution/production-continuation-review';
const historicalPaths = ['child.mjs', 'cohort.mjs', 'walker-cases.mjs', 'REPORT.md', 'EXPECTATIONS.md', 'evidence/candidate/cohort.json', 'evidence/candidate/lifecycle.json', 'evidence/candidate/public.json', 'evidence/candidate/walker.json', 'evidence/packed/cohort.json', 'evidence/packed/lifecycle.json', 'evidence/packed/public.json', 'evidence/packed/walker.json'];
const historical = historicalPaths.map(path => ({ path: `${prior}/${path}`, commit: '839f2d4', sha256: sha256(git('show', `839f2d4:${prior}/${path}`)) }));
const contractCommit = '07acb1a4d30b7592cf247a0220250317be4e2038';
const contract = ['src/contracts/command.ts', 'src/contracts/command.md'].map(path => ({ path, commit: contractCommit, sha256: sha256(git('show', `${contractCommit}:${path}`)) }));
const rootPaths = ['src/index.ts', 'src/plugins/index.ts', 'package.json'];
const rootDelta = rootPaths.filter(path => identities.find(entry => entry.path === path)?.sha256 !== sha256(git('show', `${base}:${path}`)));
if (mode === 'registration-overlay' && rootDelta.length) throw new Error('unexpected root/export delta');
const output = { label, commit, mode, base: sourceCommit, handoff, rootDelta, time: new Date().toISOString(), method: 'git-show immutable full src closure with explicit per-file commit provenance; no dirty source or live dist', node: process.version, platform: process.platform, arch: process.arch, worktreeHead: git('rev-parse', 'HEAD').toString().trim(), status: git('status', '--short').toString(), index: git('diff', '--cached', '--name-status').toString(), identities, contract, historical, riskConsumed: 0, additionalSix: 'UNUSED', defaultAcceptance: false };
await mkdir(resolve(owned, 'evidence'), { recursive: true });
await writeFile(resolve(owned, 'evidence', `${label}-freeze.json`), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ label, commit, sourceFiles: identities.length, historical: historical.length }));
