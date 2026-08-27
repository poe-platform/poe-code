import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const root = '/Users/kjopek/Workspace/safe-bash';
export const work = '/tmp/safe-bash-table-review-owned';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function save(path, value) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const lines = text.length ? (text.endsWith('\n') ? text.slice(0,-1) : text).split('\n').map(line => `+${line}`).join('\n') + '\n' : '';
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${lines}*** End Patch\n`;
  const result = spawnSync('apply_patch', [], {input: patch, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
}
export function manifest(base) {
  const files = {};
  function walk(path, label) {
    for (const entry of readdirSync(path, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.native-') || entry.name.startsWith('.snapshot-') || entry.name === '.oracle' || entry.name === 'review' || entry.name.endsWith('.local.log')) continue;
      const child = join(path, entry.name), key = `${label}/${entry.name}`;
      if (entry.isDirectory()) walk(child, key);
      else if (entry.isFile()) files[key] = sha(readFileSync(child));
    }
  }
  for (const name of ['src', 'tests']) walk(join(base, name), name);
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) files[name] = sha(readFileSync(join(base, name)));
  walk(realpathSync(join(base, 'node_modules')), 'node_modules');
  return files;
}
export function drift(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(path => before[path] !== after[path]).map(path => ({path, before: before[path] ?? null, after: after[path] ?? null}));
}
export function snapshot(name) {
  mkdirSync(work, {recursive: true});
  const target = join(work, name);
  assert.ok(!existsSync(target));
  const before = manifest(root);
  mkdirSync(target);
  for (const name of ['src', 'tests', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) cpSync(join(root, name), join(target, name), {recursive: true, filter: path => !path.split('/').some(part => part.startsWith('.native-') || part.startsWith('.snapshot-') || part === '.oracle' || part === 'review')});
  symlinkSync(join(root, 'node_modules'), join(target, 'node_modules'));
  symlinkSync(join(root, 'tests/commands/metadata-stress/.oracle'), join(target, 'tests/commands/metadata-stress/.oracle'));
  const after = manifest(root), frozen = manifest(target);
  const evidence = {time: new Date().toISOString(), rootHeadLabelOnly: spawnSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'}).stdout.trim(), target, before, after, frozen, liveCopyDrift: drift(before, after), copyDifferences: drift(after, frozen)};
  save(join(work, `${name}-inputs.json`), evidence);
  console.log(JSON.stringify({target, count: Object.keys(frozen).length, liveCopyDrift: evidence.liveCopyDrift, copyDifferences:evidence.copyDifferences}));
  return target;
}
if (process.argv[2] === 'snapshot') snapshot(process.argv[3]);
