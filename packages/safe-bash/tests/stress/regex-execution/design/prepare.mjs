import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const base = new URL('./', import.meta.url);
const root = new URL('../../../../', base);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(new URL(path, root));
const prefix = 'tests/stress/regex-execution/design/';
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000 }).stdout.trim();
const source = {};
const visit = relative => {
  for (const entry of readdirSync(new URL(relative, root), { withFileTypes: true })) {
    const path = relative + entry.name;
    if (entry.isDirectory() && !['.build', 'review', 'evidence'].includes(entry.name)) visit(path + '/');
    else if (entry.isFile() && (path.endsWith('.ts') || path.endsWith('.mjs') || path.endsWith('tsconfig.json'))) source[path] = hash(read(path));
  }
};
visit(prefix);
for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'AGENTS.md', 'node_modules/typescript/package.json', 'node_modules/typescript/lib/_tsc.js', 'node_modules/@types/node/package.json']) source[path] = hash(read(path));
mkdirSync(new URL('.build/', base), { recursive: true });
const build = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', fileURLToPath(new URL('tsconfig.json', base)), '--listFiles', '--listEmittedFiles', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
writeFileSync(new URL('compiler.json', base), JSON.stringify({ status: build.status, error: build.error?.message, stdout: build.stdout, stderr: build.stderr }, null, 2) + '\n');
if (build.status !== 0) throw new Error('COMPILER_FAILED');
const built = {};
for (const path of build.stdout.split('\n')) {
  if (path.startsWith(fileURLToPath(root))) source[path.slice(fileURLToPath(root).length)] = hash(readFileSync(path));
  if (path.startsWith('TSFILE: ')) { const name = path.slice(8); built[name.slice(fileURLToPath(root).length)] = hash(readFileSync(name)); }
}
const prior = JSON.parse(readFileSync(new URL('../compiled-matrix/frozen.json', base)));
const history = {};
for (const path of ['REPORT.md', 'RESEARCH.md', 'SOURCE_MAP.json', 'compiled-matrix/REPORT.md', 'compiled-matrix/frozen.json', 'bounded-matrix/cases.mjs']) history[path] = hash(readFileSync(new URL('../' + path, base)));
const artifact = { date: new Date().toISOString(), head: git('rev-parse', 'HEAD'), status: git('status', '--short'), runtime: { node: process.version, v8: process.versions.v8, execArgv: process.execArgv, platform: process.platform, arch: process.arch }, compiler: JSON.parse(read('node_modules/typescript/package.json')).version, source, built, history, historicalSourceCommit: prior.sourceCommit, package: JSON.parse(read('package.json')), compilerConfig: JSON.parse(read(prefix + 'tsconfig.json')) };
const bundle = Object.fromEntries(Object.keys(source).filter(path => path.startsWith('src/') || path.startsWith(prefix)).map(path => [path, read(path).toString()]));
const filename = process.argv[2] === '--rebuild' ? 'rebuild.json' : 'frozen.json';
if (filename === 'frozen.json' && existsSync(new URL(filename, base)) && (process.argv[2] !== '--refreeze' || existsSync(new URL('evidence/', base)))) throw new Error('FREEZE_EXISTS');
if (filename === 'rebuild.json') {
  const frozen = JSON.parse(readFileSync(new URL('frozen.json', base)));
  for (const [path, digest] of Object.entries(frozen.built)) if (built[path] !== digest) throw new Error('REBUILD_DRIFT ' + path);
}
writeFileSync(new URL(filename, base), JSON.stringify(artifact, null, 2) + '\n');
if (filename === 'frozen.json') writeFileSync(new URL('source-bundle.json', base), JSON.stringify(bundle, null, 2) + '\n');
console.log(JSON.stringify({ compiled: Object.keys(built).length, sources: Object.keys(source).length, filename }));
