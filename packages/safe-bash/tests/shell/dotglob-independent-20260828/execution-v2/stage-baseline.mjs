import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { hash, inventory, save } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory } from '../execution-prep-v1/admission.mjs';

export const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(ownRoot, '../../..');
const prefix = 'tests/shell/dotglob-independent-20260828/';
export function stageBaseline(revision, label) {
  assert.match(revision, /^[a-f0-9]{40}$/u); assert.match(label, /^[a-z0-9-]+$/u);
  const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  const binding = JSON.parse(git(['show', `${revision}:${prefix}stack-binding-v1/BINDING.json`]));
  const work = realpathSync(mkdtempSync(join(ownRoot, `.baseline-${label}-`)));
  const initial = join(work, 'before-move'), moved = join(work, 'moved');
  mkdirSync(join(initial, 'node_modules'), { recursive: true });
  const packageRoot = join(initial, 'node_modules/virtual-bash');
  const archive = Buffer.from(git(['show', `${binding.package.revision}:${binding.package.path}`]).toString().trim(), 'base64');
  assert.equal(hash(archive), binding.package.sha256);
  const bytes = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  let offset = 0;
  while (offset + 512 <= bytes.length && bytes[offset] !== 0) {
    const header = bytes.subarray(offset, offset + 512);
    const path = header.subarray(0, 100).toString().split('\0')[0].slice(8);
    const size = parseInt(header.subarray(124, 136).toString().split('\0')[0].trim(), 8);
    const expected = binding.package.members[path]; assert.ok(expected);
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    assert.equal(hash(content), expected.sha256);
    const target = join(packageRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content, { flag: 'wx' }); chmodSync(target, expected.mode);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assertInventory(packageRoot, binding.package.members);
  const harness = join(initial, 'harness'); mkdirSync(harness);
  const names = git(['ls-tree', '-r', '--name-only', revision, '--', prefix]).toString().trim().split('\n');
  const selected = names.filter(path => !/\/(?:preparation-evidence-v1|baseline-evidence-v1)\//u.test(path));
  for (const path of selected) {
    const name = path.slice(prefix.length); assert.equal(name.split('/').includes('AGENTS.md'), false);
    const target = join(harness, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, git(['show', `${revision}:${path}`]), { flag: 'wx' });
  }
  writeFileSync(join(initial, 'package.json'), '{"type":"module","private":true}\n');
  for (const tool of binding.typeTools) for (const [name, entry] of Object.entries(tool.inventory.files)) {
    const bytes = readFileSync(join(tool.root, name)); assert.equal(hash(bytes), entry.sha256);
    const target = join(initial, 'node_modules', tool.name, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); chmodSync(target, entry.mode);
  }
  renameSync(initial, moved);
  const finalPackage = join(moved, 'node_modules/virtual-bash'), finalHarness = join(moved, 'harness');
  assertInventory(finalPackage, binding.package.members);
  const scratchRoot = join(work, 'vfs-scratch'); mkdirSync(scratchRoot);
  prepareRealFixture(scratchRoot, 'baseline');
  const manifest = {
    kind: 'dotglob-stack-baseline-calibration-v1', acceptedComposition: binding.acceptedComposition, packageSha256: binding.package.sha256,
    dotglobCandidate: null, node: binding.node, packageRoot: finalPackage, harnessRoot: finalHarness, scratchRoot,
    rootModule: join(finalPackage, 'dist/index.js'), runtimeModule: join(finalPackage, 'dist/shell/runtime.js'), patternModule: join(finalPackage, 'dist/shell/pattern.js'),
    forbiddenSource: join(repository, 'src/index.ts'),
    trees: [{ root: finalPackage, files: inventory(finalPackage) }, { root: finalHarness, files: inventory(finalHarness) }],
    requiredFiles: [join(finalPackage, 'dist/index.js'), join(finalPackage, 'dist/index.d.ts'), join(finalPackage, 'dist/shell/runtime.js')],
    binding: { defaultNames: binding.defaultNames },
  };
  const manifestPath = join(work, 'manifest.json'); save(manifestPath, manifest);
  return { work, moved, packageRoot: finalPackage, harnessRoot: finalHarness, binding, manifest, manifestPath, manifestSha256: hash(readFileSync(manifestPath)), archiveSha256: hash(archive), preparationRevision: revision, movedFrom: initial };
}

export function prepareRealFixture(scratchRoot, label) {
  assert.match(label, /^[a-z0-9-]+$/u);
  const owned = join(scratchRoot, label), root = join(owned, 'root');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(owned, 'outside.txt'), 'owned-outside-sentinel', { flag: 'wx' });
  symlinkSync('../outside.txt', join(root, 'escape'));
}
