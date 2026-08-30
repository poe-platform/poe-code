import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from '../../../../node_modules/typescript/lib/typescript.js';
import { productFiles, limits } from '../bounded-matrix/cases.mjs';
import { root, base, build, scripts, json, sha, digest, hashes, same, runtime, observations, save } from './guard.mjs';

const rebuild = process.argv[2] === 'rebuild';
if (process.argv.length !== (rebuild ? 3 : 2) || existsSync(build)) throw new Error('Fixed empty owned build directory required');
if (!rebuild && existsSync(new URL('frozen.json', base))) throw new Error('Never refresh existing freeze');
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 2 ** 20 });
  if (result.status !== 0) throw new Error('Git source identity failure');
  return result.stdout;
};
const metadata = ['package.json', 'tsconfig.json', 'tsconfig.build.json'];
let bundle;
if (rebuild) bundle = json(new URL('source-bundle.json', base));
else {
  const sourceCommit = git('rev-parse', 'HEAD').trim();
  const files = Object.fromEntries([...productFiles, ...metadata].map(name => {
    const text = git('show', `${sourceCommit}:${name}`);
    if (sha(text) !== digest(new URL(name, root))) throw new Error(`Uncommitted source: ${name}`);
    return [name, text];
  }));
  bundle = { sourceCommit, files };
  save(new URL('source-bundle.json', base), bundle);
}
mkdirSync(build);
for (const [name, text] of Object.entries(bundle.files)) {
  const target = new URL(name, build);
  mkdirSync(new URL('./', target), { recursive: true });
  writeFileSync(target, text, { flag: 'wx' });
}
const owner = { namespace: 'compiled-matrix', sourceBundle: digest(new URL('source-bundle.json', base)) };
save(new URL('owner.json', build), owner);
const config = { extends: './tsconfig.build.json', compilerOptions: {
  rootDir: 'src', outDir: 'js', declaration: false, declarationMap: false, sourceMap: false, noEmitOnError: true,
}, files: productFiles, include: [], exclude: [] };
save(new URL('tsconfig.compiled.json', build), config);
const compilerFiles = ['node_modules/typescript/package.json', 'node_modules/typescript/bin/tsc',
  'node_modules/typescript/lib/tsc.js', 'node_modules/typescript/lib/_tsc.js', 'node_modules/typescript/lib/typescript.js'];
const compilerHashes = hashes(compilerFiles);
if (!rebuild) {
  const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  if (help.status !== 0) throw new Error('Local Node help failed');
  save(new URL('local-profile.json', base), { runtime: runtime(), nodeHelp: help.stdout,
    compilerPackage: json(new URL('node_modules/typescript/package.json', root)),
    package: json(new URL('package.json', build)), config, compilerHashes,
    loader: 'Existing tsc emits JavaScript; plain Node ESM loads only .js. No runtime TS loader required.' });
}
const compiler = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256',
  fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', fileURLToPath(new URL('tsconfig.compiled.json', build)),
  '--listFiles', '--listEmittedFiles', '--pretty', 'false'], {
  cwd: root, shell: false, env: { LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8', timeout: 30000, maxBuffer: 65536,
});
save(new URL(rebuild ? 'rebuild-compiler.json' : 'compiler.json', base), {
  status: compiler.status, signal: compiler.signal, error: compiler.error?.message ?? null,
  stdout: compiler.stdout, stderr: compiler.stderr, timeoutMs: 30000, version: ts.version,
});
if (compiler.status !== 0 || !same(compilerHashes, hashes(compilerFiles))) throw new Error('Bounded compiler preparation failed');
const buildPaths = [...productFiles.map(name => name.replace(/^src\//u, 'js/').replace(/\.ts$/u, '.js')),
  'package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.compiled.json', 'owner.json'];
const graph = {};
const builtins = new Set(['node:path', 'node:util', 'node:stream/web', 'node:buffer', 'node:timers/promises']);
for (const name of buildPaths.filter(name => name.endsWith('.js'))) {
  const source = ts.createSourceFile(name, readFileSync(new URL(name, build), 'utf8'), ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  const dependencies = [];
  const visit = node => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text))) throw new Error('Unexpected dynamic loading/evaluation');
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = node.moduleSpecifier.text;
      if (!builtins.has(specifier)) {
        if (!specifier.startsWith('.')) throw new Error('External package in compiled runtime');
        const target = new URL(specifier, new URL(name, build)).href;
        const dependency = buildPaths.find(path => new URL(path, build).href === target);
        if (!dependency) throw new Error('Import outside compiled closure');
        dependencies.push(dependency);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  graph[name] = dependencies;
}
const runtimeClosures = {};
for (const [tool, entry] of [['grep', 'js/commands/grep.js'], ['rg', 'js/commands/search/rg.js']]) {
  const seen = new Set();
  const visit = name => { if (seen.has(name)) return; seen.add(name); graph[name].forEach(visit); };
  visit(entry);
  runtimeClosures[tool] = [...seen].sort();
}
const typeInputs = compiler.stdout.split('\n').filter(line => line.startsWith(fileURLToPath(root)) && !line.startsWith(fileURLToPath(build)));
const typeHashes = Object.fromEntries(typeInputs.map(path => [path.slice(fileURLToPath(root).length), digest(path)]));
const frozen = { utc: new Date().toISOString(), runtime: runtime(), limits, bundleHash: owner.sourceBundle,
  sourceCommit: bundle.sourceCommit, sourceHashes: hashes(Object.keys(bundle.files), build),
  buildHashes: hashes(buildPaths, build), compilerHashes, typeHashes, compilerVersion: ts.version,
  scripts: hashes(scripts, base), graph, runtimeClosures, liveSourceHashes: hashes(productFiles), observationHashes: observations() };
if (rebuild) {
  const original = json(new URL('frozen.json', base));
  if (!same(frozen.sourceHashes, original.sourceHashes) || !same(frozen.buildHashes, original.buildHashes)
    || !same(frozen.compilerHashes, original.compilerHashes) || !same(frozen.typeHashes, original.typeHashes)) throw new Error('Nonidentical rebuild');
  save(new URL('rebuild-proof.json', base), { utc: frozen.utc, sourceHashes: frozen.sourceHashes, buildHashes: frozen.buildHashes });
} else {
  const history = [];
  const collect = directory => {
    for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
      const name = directory + '/' + entry.name;
      if (entry.isDirectory()) collect(name);
      else if (entry.isFile()) history.push(name);
      else throw new Error('Unexpected historical symlink');
    }
  };
  for (const name of ['bounded-matrix', 'matrix-scope-review', 'matrix-continuation', 'loader-continuation']) collect('tests/stress/regex-execution/' + name);
  frozen.history = hashes(history.sort());
  save(new URL('frozen.json', base), frozen);
}
console.log(JSON.stringify({ compiler: ts.version, modules: productFiles.length, compiled: true, rebuild }));
