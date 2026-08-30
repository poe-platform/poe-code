import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [repositoryArgument, outputArgument] = process.argv.slice(2);
assert.ok(repositoryArgument && outputArgument, 'Usage: node check-controls.mjs REPOSITORY NEW_SCRATCH_DIRECTORY');
const repository = resolve(repositoryArgument);
const output = resolve(outputArgument);
mkdirSync(output);
const results = [];
function command(name, binary, args, expected) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  const record = { name, command: [binary, ...args], status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  writeFileSync(join(output, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  results.push(record);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, expected, name);
  return record;
}
for (const name of ['corrupt-body', 'incorrect-source-binding']) {
  const copy = join(output, name);
  mkdirSync(copy);
  for (const file of ['reconstruct.mjs', 'MANIFEST.json', 'candidate.commit.raw']) cpSync(join(here, file), join(copy, file));
  if (name === 'corrupt-body') {
    const body = readFileSync(join(copy, 'candidate.commit.raw'));
    body[body.length - 2] ^= 1;
    writeFileSync(join(copy, 'candidate.commit.raw'), body);
  } else {
    const manifest = JSON.parse(readFileSync(join(copy, 'MANIFEST.json')));
    manifest.bindings[0].blob = '0000000000000000000000000000000000000000';
    writeFileSync(join(copy, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const record = command(name, process.execPath, [join(copy, 'reconstruct.mjs'), '--repository', repository, '--output', join(copy, 'run'), '--mode', 'objects'], 1);
  const report = JSON.parse(readFileSync(join(copy, 'run/REPORT.json')));
  assert.equal(report.reconstruction, undefined);
  assert.match(report.error, name === 'corrupt-body' ? /Raw commit body SHA-256/ : /0000000000000000000000000000000000000000/);
  assert.match(record.stdout, /"status":"FAIL"/);
}
const empty = join(output, 'empty-repository');
command('initialize-empty-source', '/usr/bin/git', ['init', '--template=', '--initial-branch=unborn', empty], 0);
command('missing-reachable-anchor', process.execPath, [join(here, 'reconstruct.mjs'), '--repository', empty, '--output', join(output, 'missing-anchor'), '--mode', 'objects'], 1);
const missing = JSON.parse(readFileSync(join(output, 'missing-anchor/REPORT.json')));
assert.match(missing.error, /reachable-anchor: exit 128/);
assert.equal(missing.steps.at(-1).name, 'reachable-anchor');
command('reject-existing-output', process.execPath, [join(here, 'reconstruct.mjs'), '--repository', repository, '--output', join(output, 'missing-anchor'), '--mode', 'objects'], 1);
assert.match(results.at(-1).stderr, /EEXIST/);
console.log(JSON.stringify({ status: 'PASS provenance controls only', controls: 4, output }));
