import assert from 'node:assert/strict';
import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const scope = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(scope, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const cd = '4641075df5355a91c83bf5b2cc3a88dfaf1f5153';
const inspect = filename => {
  const stat = lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink(), filename);
  const bytes = readFileSync(filename);
  return { path: filename, bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes) };
};
const tools = [
  ['/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c'],
  ['/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/doc/bashref.texi', 'f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5'],
  ['/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'],
  [git, '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9'],
].map(([filename, expected]) => {
  const binding = inspect(filename);
  assert.equal(binding.sha256, expected, filename);
  return binding;
});
const runGit = args => execFileSync(git, args, { cwd: repo, maxBuffer: 2 * 1024 * 1024, timeout: 5000 });
const names = runGit(['ls-tree', '--name-only', baseline, 'src/shell/']).toString().trim().split('\n');
const source = names.map(filename => {
  const commit = filename === 'src/shell/runtime.ts' ? cd : baseline;
  const bytes = runGit(['show', `${commit}:${filename}`]);
  if (commit === baseline) assert.equal(hash(runGit(['show', `${cd}:${filename}`])), hash(bytes), filename);
  return { path: filename, commit, blob: runGit(['rev-parse', `${commit}:${filename}`]).toString().trim(), bytes: bytes.length, sha256: hash(bytes) };
});
const delta = runGit(['diff', '--name-only', baseline, cd, '--', 'src/shell/']).toString().trim();
assert.equal(delta, 'src/shell/runtime.ts');
const bindings = {
  schema: 'let-design-source-and-native-bindings-v1', created: new Date().toISOString(),
  baseline, cd, composition: 'baseline plus only CD runtime.ts; never the full CD tree',
  rootAcceptance: '192ab78b (user authoritative, qualification retained)', tools, source,
  productExecution: 0, nativeExecutionBeforeSeal: 0,
};
writeFileSync(resolve(scope, 'BINDINGS.json'), `${JSON.stringify(bindings, null, 2)}\n`, { flag: 'wx' });
const recipes = ['CASES.json', 'PROTOCOL.md', 'seal.mjs', 'native.mjs', 'BINDINGS.json'].map(filename => ({ ...inspect(resolve(scope, filename)), path: filename }));
const manifest = { schema: 'let-native-recipe-seal-v1', created: new Date().toISOString(), recipes };
writeFileSync(resolve(scope, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ manifestSHA256: hash(readFileSync(resolve(scope, 'MANIFEST.json'))), sourceFiles: source.length, nativeRows: 28, nativeExecutions: 0 }));
