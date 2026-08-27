import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, '../../..');
const releasePath = '/tmp/safe-bash-stream-next-review.ready';
if (!existsSync(releasePath)) throw new Error('BLOCKED: root source-review release absent; no product execution');
const release = readFileSync(releasePath, 'utf8');
if (!/CLOSED/u.test(release) || !/stream-format/u.test(release) || !/split/u.test(release) || !/[a-f0-9]{40}/u.test(release)) {
  throw new Error('BLOCKED: release must confirm CLOSED authors and source commits/hashes');
}
const sourceCommit = /Freeze source commit ([a-f0-9]{40})/u.exec(release)?.[1];
if (!sourceCommit) throw new Error('BLOCKED: root must identify the immutable combined source commit');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(readFileSync(join(owned, 'frozen/manifest.json'), 'utf8'));
for (const [path, hash] of Object.entries(manifest.files)) {
  if (sha256(readFileSync(join(owned, path))) !== hash) throw new Error(`Frozen evidence changed: ${path}`);
}
const git = args => {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
const committedBytes = path => {
  const result = spawnSync('git', ['show', `${sourceCommit}:${path}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
};
for (const ancestor of ['d74ca02', '98a28f1', '4244e9a', '1836795']) git(['merge-base', '--is-ancestor', ancestor, sourceCommit]);
const targetPaths = ['src/commands/stream-format', 'src/commands/split'];
mkdirSync(join(owned, '.private'), { recursive: true });
const run = mkdtempSync(join(owned, '.private/review-'));
const snapshot = join(run, 'snapshot');
mkdirSync(snapshot);
const files = [];
const committedPaths = git(['ls-tree', '-r', '--name-only', sourceCommit, '--', 'src']).trim().split('\n');
for (const path of [...committedPaths, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) {
  const buffer = committedBytes(path);
  files.push({ path, sha256: sha256(buffer), bytes: buffer.length });
  mkdirSync(dirname(join(snapshot, path)), { recursive: true });
  writeFileSync(join(snapshot, path), buffer);
}
const harnessPath = 'tests/commands/stream-next-stress/independent.review.ts';
mkdirSync(dirname(join(snapshot, harnessPath)), { recursive: true });
copyFileSync(join(repository, harnessPath), join(snapshot, harnessPath));
const harnessSha256 = sha256(readFileSync(join(snapshot, harnessPath)));
const splitSource = files.filter(file => file.path.startsWith('src/commands/split/') && file.path.endsWith('.ts')).sort((left, right) => left.path.localeCompare(right.path));
const splitDigest = sha256(splitSource.map(file => `${file.path}\0${file.sha256}\n`).join(''));
if (sourceCommit === '1c745c3a633c32a8e9d87dacfdf33fcadc00caf2') {
  if (splitDigest !== '9b6f0f7ac5e57a950212bc4d96909ef1839848e37af9b13002237613b2e2a7f6') throw new Error('Split author digest mismatch in initial immutable snapshot');
  const formatHandoff = readFileSync('/tmp/safe-bash-stream-next-format-result.txt', 'utf8');
  for (const file of files.filter(file => file.path.startsWith('src/commands/stream-format/') && file.path.endsWith('.ts'))) {
    if (!formatHandoff.includes(file.sha256)) throw new Error(`Format author hash mismatch: ${file.path}`);
  }
}
const compiler = join(repository, 'node_modules/typescript/bin/tsc');
const configuration = { extends: './tsconfig.json', compilerOptions: {
  rootDir: '.', outDir: './emitted', declaration: false, sourceMap: false,
  typeRoots: [join(repository, 'node_modules/@types')],
}, include: ['tests/commands/stream-next-stress/independent.review.ts'], exclude: ['emitted', 'node_modules'] };
writeFileSync(join(snapshot, 'tsconfig.review.json'), JSON.stringify(configuration, null, 2));
const metadata = { startedAt: new Date().toISOString(), release, sourceCommit, harnessPath, harnessSha256, splitDigest, head: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--short']),
  authorSourceCommits: targetPaths.map(path => ({ path, commit: git(['log', '-1', '--format=%H', sourceCommit, '--', path]).trim() })),
  indexBefore: git(['diff', '--cached', '--name-only']), sourceFiles: files, sourceTreeSha256: sha256(JSON.stringify(files)),
  run, node: process.version, nodeExecutable: process.execPath, nodeSha256: sha256(readFileSync(process.execPath)), platform: process.platform, arch: process.arch,
  compilerSha256: sha256(readFileSync(compiler)), compilerLibrarySha256: sha256(readFileSync(join(repository, 'node_modules/typescript/lib/_tsc.js'))),
  typescript: JSON.parse(readFileSync(join(repository, 'node_modules/typescript/package.json'), 'utf8')).version,
  nodeTypes: JSON.parse(readFileSync(join(repository, 'node_modules/@types/node/package.json'), 'utf8')).version,
  generatedConfiguration: configuration, runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  mode: 'source-only isolated emitted JS; no tsx/loader/root dist/package-public import proof', frozenManifest: manifest };
writeFileSync(join(run, 'snapshot.json'), JSON.stringify(metadata, null, 2) + '\n');
const compile = spawnSync(process.execPath, [compiler, '-p', join(snapshot, 'tsconfig.review.json')], { cwd: snapshot, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
writeFileSync(join(run, 'compile.json'), JSON.stringify({ status: compile.status, signal: compile.signal, error: compile.error?.message, stdout: compile.stdout, stderr: compile.stderr }, null, 2) + '\n');
console.log(JSON.stringify({ run, sourceTreeSha256: metadata.sourceTreeSha256, compileStatus: compile.status }));
if (compile.status !== 0 || compile.error) {
  console.error('Preexecution compiler/helper failure, NOT a product behavioral failure', compile.stdout, compile.stderr);
  process.exitCode = 2;
} else {
  const emitted = [];
  const scanEmitted = relative => {
    for (const entry of readdirSync(join(snapshot, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) scanEmitted(path);
      else emitted.push({ path, sha256: sha256(readFileSync(join(snapshot, path))) });
    }
  };
  scanEmitted('emitted');
  writeFileSync(join(run, 'emitted.json'), JSON.stringify(emitted, null, 2) + '\n');
  const execution = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--test', '--test-concurrency=1', join(snapshot, 'emitted/tests/commands/stream-next-stress/independent.review.js')], {
    cwd: snapshot, env: { PATH: '/usr/bin:/bin', STREAM_NEXT_REVIEW_OUTPUT: run, STREAM_NEXT_REVIEW_FROZEN: join(owned, 'frozen/native.json') },
    encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(join(run, 'test.json'), JSON.stringify({ status: execution.status, signal: execution.signal, error: execution.error?.message, stdout: execution.stdout, stderr: execution.stderr }, null, 2) + '\n');
  console.log(execution.stdout);
  console.error(execution.stderr);
  if (existsSync(join(run, 'results.json'))) console.log(JSON.stringify(JSON.parse(readFileSync(join(run, 'results.json'), 'utf8')).summary, null, 2));
  process.exitCode = execution.status ?? 2;
}
writeFileSync(join(run, 'completion.json'), JSON.stringify({ endedAt: new Date().toISOString(), indexAfter: git(['diff', '--cached', '--name-only']), workspaceSourceChangedSinceSnapshot: files.filter(file => sha256(readFileSync(join(repository, file.path))) !== file.sha256).map(file => file.path) }, null, 2) + '\n');
