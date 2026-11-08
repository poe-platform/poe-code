import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, '../../..');
const candidate = 'c26892c3a1a419311c9cf46a6c2976e696e00624';
const freeze = '8600ca5730a130316b16f13c4cd54689a4b015a9';
const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const npm = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = (revision, filename) => execFileSync(git, ['show', `${revision}:${filename}`], { cwd: repo, maxBuffer: 4 * 1024 * 1024, timeout: 5000 });
const freezePath = 'tests/shell/let-independent-20260828/';
const frozen = JSON.parse(blob(freeze, freezePath + 'BINDINGS.json'));
assert.equal(frozen.source.length, 265);
const resume = process.argv[2] === '--resume-regular-tar';
const work = join(own, 'work');
mkdirSync(work, { recursive: resume });
mkdirSync(join(work, 'node_modules'), { recursive: resume });
mkdirSync(join(own, 'evidence-v1'), { recursive: resume });
const source = join(work, 'node_modules/selected-source');
mkdirSync(source, { recursive: resume });
const write = (filename, bytes, mode = 0o644) => {
  if (resume && existsSync(filename)) {
    assert(lstatSync(filename).isFile() && !lstatSync(filename).isSymbolicLink());
    assert.equal(lstatSync(filename).mode & 0o777, mode);
    assert.equal(hash(readFileSync(filename)), hash(bytes), filename);
    return;
  }
  mkdirSync(dirname(filename), { recursive: true }); writeFileSync(filename, bytes, { flag: 'wx', mode });
};
const selected = [];
for (const binding of frozen.source) {
  assert(!binding.path.split('/').includes('AGENTS.md'));
  assert(!binding.path.includes('..') && !binding.path.startsWith('/'));
  const original = blob(binding.revision, binding.path);
  assert.equal(hash(original), binding.sha256, binding.path);
  const bytes = binding.path === 'src/shell/runtime.ts' ? blob(candidate, binding.path) : original;
  write(join(source, binding.path), bytes, binding.mode & 0o777);
  selected.push({ ...binding, revision: binding.path === 'src/shell/runtime.ts' ? candidate : binding.revision, sha256: hash(bytes), bytes: bytes.length, originalSHA256: binding.sha256 });
}
const regressions = [
  'tests/shell/core.test.ts', 'tests/shell/runtime-regressions.test.ts',
  'tests/shell/getopts/runtime/state.test.ts', 'tests/shell/getopts/runtime/ordering.test.ts',
  'tests/shell/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup-pipeline.test.ts',
  'tests/shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts',
  'tests/shell/cd-prerequisite-20260828/runtime-v1/cd.test.ts',
];
const helpers = ['tests/shell/helpers.ts', 'tests/shell/getopts/runtime/helpers.ts', 'tests/shell/getopts-independent-20260827/stage2/corpus.mjs'];
const fixtures = execFileSync(git, ['ls-tree', '-r', '--name-only', baseline, 'tests/shell/getopts-independent-20260827/stage2/fixtures'], { cwd: repo }).toString().trim().split('\n').filter(Boolean);
const testInputs = [];
for (const filename of [...regressions, ...helpers, ...fixtures]) {
  assert(!filename.endsWith('AGENTS.md'));
  const revision = filename.includes('/cd-prerequisite-') ? frozen.cd : filename.includes('/cancellation-stage2-author-') ? '43af14a520160fad4e144a6b60c30ca123bd9ab9' : baseline;
  const bytes = blob(revision, filename);
  write(join(source, filename), bytes);
  testInputs.push({ path: filename, revision, bytes: bytes.length, sha256: hash(bytes) });
}
const freezeInputs = {};
for (const filename of ['cases.json', 'consumer.mts.fixture', 'negative-api.mts.fixture', 'negative-limit.mts.fixture', 'BINDINGS.json', 'SEAL.json']) {
  const bytes = blob(freeze, freezePath + filename);
  freezeInputs[filename] = hash(bytes);
  write(join(own, 'evidence-v1', `frozen-${filename}`), bytes);
}
const tools = [];
const inventory = (root, copyRoot) => {
  const visit = relative => {
    for (const entry of readdirSync(join(root, relative)).sort()) {
      const filename = join(relative, entry);
      assert.notEqual(entry, 'AGENTS.md', `tool name forbidden: ${filename}`);
      const stat = lstatSync(join(root, filename));
      if (stat.isSymbolicLink()) {
        assert(!copyRoot, `copy symlink forbidden: ${filename}`);
        tools.push({ path: join(root, filename), alias: readlinkSync(join(root, filename)), metadataOnly: true });
      } else if (stat.isDirectory()) visit(filename);
      else {
        assert(stat.isFile());
        const bytes = readFileSync(join(root, filename));
        tools.push({ path: join(root, filename), bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes) });
        if (copyRoot) write(join(copyRoot, filename), bytes, stat.mode & 0o777);
      }
    }
  };
  visit('');
};
for (const filename of [node, git, '/usr/bin/bsdtar']) {
  const stat = lstatSync(filename); assert(stat.isFile());
  const bytes = readFileSync(filename); tools.push({ path: filename, bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes) });
}
assert.equal(tools[0].sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
inventory(npm);
for (const name of ['typescript', '@types/node', 'undici-types', 'tsx', 'esbuild', '@esbuild/darwin-arm64']) inventory(join(repo, 'node_modules', name), join(work, 'node_modules', name));
const record = { schema: 'let-author-selected-composition-v1', candidate, freeze, baseline, source, sourceInputs: selected, testInputs, regressions, freezeInputs, tools, node, git, npm, created: new Date().toISOString(), nativeExecutions: 0, productExecutions: 0, preparation: 'regular-file Git blobs and qualified local tool copies only; no AGENTS or live source fallback' };
write(join(own, 'evidence-v1/INPUTS.json'), Buffer.from(JSON.stringify(record, null, 2) + '\n'));
console.log(JSON.stringify({ selectedInputs: selected.length, testInputs: testInputs.length, toolBindings: tools.length, productExecutions: 0, candidate }));
