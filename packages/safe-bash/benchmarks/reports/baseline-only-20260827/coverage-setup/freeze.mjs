import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = '/Users/kjopek/Workspace/safe-bash';
if (process.cwd() !== root) throw new Error('Run only from assigned workspace');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
const visit = path => {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) visit(`${path}/${name}`);
  } else files.push({ path, bytes: statSync(path).size, sha256: digest(readFileSync(path)) });
};
for (const path of ['AGENTS.md', 'README.md', 'package.json', 'package-lock.json', 'src', 'benchmarks/package.json', 'benchmarks/package-lock.json', 'benchmarks/expanded', 'benchmarks/reports/expanded-20260827/baseline-only-frozen', 'benchmarks/reports/expanded-20260827/corrected-bd2cacb/report.json', 'benchmarks/reports/expanded-20260827/corrected-bd2cacb/functional.json', 'benchmarks/node_modules/just-bash']) visit(path);
const capture = {
  capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }),
  index: execFileSync('git', ['diff', '--cached', '--raw'], { encoding: 'utf8' }),
  files, fileManifestSha256: digest(JSON.stringify(files)),
  native: ['/bin/bash', '/opt/homebrew/bin/bash', '/opt/homebrew/bin/gsed'].flatMap(path => {
    try { return [{ path, bytes: statSync(path).size, sha256: digest(readFileSync(path)) }]; } catch { return []; }
  }),
};
const destination = `benchmarks/reports/baseline-only-20260827/coverage-setup/${process.argv[2]}.json`;
if (!['before', 'after'].includes(process.argv[2])) throw new Error('Expected before or after');
execFileSync('apply_patch', [`*** Begin Patch\n*** Add File: ${destination}\n${JSON.stringify(capture, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`], { stdio: 'inherit' });
