import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export async function stageTypingHelper({root, repository, profile, environment, git}) {
  const entries = new Map(profile.scopeInputs.map(entry => [entry.path, entry]));
  const selected = new Map();
  let bytes = 0;
  const run = args => {
    const result = spawnSync(git, ['--no-replace-objects', ...args], {cwd: repository, env: environment, encoding: null, timeout: 10000, maxBuffer: 16 * 1024 * 1024});
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  const stage = path => {
    if (selected.has(path)) return;
    assert.ok(!path.split('/').some(name => /^agents\.md$/iu.test(name)), 'no instruction materialization');
    const entry = entries.get(path);
    assert.ok(entry && ['100644', '100755'].includes(entry.mode), 'fixed regular helper input required: ' + path);
    bytes += entry.bytes; assert.ok(bytes <= 64 * 1024 * 1024, 'bounded helper-only selection');
    const body = run(['cat-file', 'blob', entry.blob]);
    assert.equal(body.length, entry.bytes);
    assert.equal(createHash('sha1').update(Buffer.from('blob ' + body.length + '\0')).update(body).digest('hex'), entry.blob);
    const destination = join(root, path); mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, body, {flag: 'wx'}); chmodSync(destination, entry.mode === '100755' ? 0o755 : 0o644);
    selected.set(path, {...entry, sha256: createHash('sha256').update(body).digest('hex')});
  };
  for (const entry of entries.values()) if (entry.path.startsWith('scripts/') || entry.path.startsWith('tests/plugins/qualified-current-release/')) stage(entry.path);
  stage('tests/plugins/stream-five-public/current-profile.mjs');
  stage('tsconfig.json');
  const owner = 'tests/plugins/qualified-current-release/';
  const captured = JSON.parse(readFileSync(join(root, owner, 'captured-types.json')));
  stage(captured.provenance);
  for (const entry of captured.evidence) stage(entry.path);
  for (const entry of captured.entries) { stage(entry.path); stage(entry.originalPath); }
  const staged = JSON.parse(readFileSync(join(root, owner, 'staged-types.json')));
  for (const entry of staged.entries) { stage(entry.path); stage(entry.owner.path); }
  const inventory = JSON.parse(readFileSync(join(root, owner, 'inventory.json')));
  for (const entry of inventory.entries) {
    stage(entry.path);
    for (const evidence of entry.freeze?.evidence ?? []) stage(evidence.path);
  }
  const consumers = await import(pathToFileURL(join(root, owner, 'consumers.mjs')));
  for (const group of consumers.currentSourceConsumerGroups) for (const path of group.files) stage(path);
  for (const path of consumers.currentConsumerPaths()) stage(path);
  const init = spawnSync(git, ['init', '--quiet', '--template=', root], {env: environment, timeout: 10000, encoding: 'utf8'});
  assert.equal(init.status, 0, init.stderr);
  const index = spawnSync(git, ['update-index', '-z', '--index-info'], {cwd: root, env: environment, input: profile.scopeInputs.map(entry => `${entry.mode} ${entry.blob}\t${entry.path}\0`).join(''), timeout: 10000, encoding: 'utf8'});
  assert.equal(index.status, 0, index.stderr);
  writeFileSync(join(root, '.git/HEAD'), profile.candidate + '\n');
  return {candidate: profile.candidate, physicalFiles: selected.size, bytes, entries: [...selected.values()], indexedPaths: profile.scopeInputs.length, qualification: 'Exact frozen helper/data selection and metadata-only index; no full candidate materialization, build, instruction body or package proof.'};
}
