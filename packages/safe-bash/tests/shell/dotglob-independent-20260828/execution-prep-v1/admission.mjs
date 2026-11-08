import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { hash, inventory, json, git } from './artifacts.mjs';

export const PREPARATION_STATUS = 78;
export function refuse(message) { throw Object.assign(new Error(message), { exitCode: PREPARATION_STATUS }); }
export function regular(path) {
  assert.equal(resolve(path), path, 'absolute normalized path');
  assert.equal(realpathSync(path), path, 'no symlink/alias');
  assert.ok(lstatSync(path).isFile(), 'regular file');
  return readFileSync(path);
}
export function digestFile(path, expected) {
  assert.match(expected ?? '', /^[a-f0-9]{64}$/u, 'explicit SHA256');
  const bytes = regular(path);
  assert.equal(hash(bytes), expected, `bound bytes ${path}`);
  return bytes;
}
export function assertInventory(root, expected) {
  assert.ok(isAbsolute(root));
  assert.equal(realpathSync(root), root);
  for (const [name, item] of Object.entries(expected)) {
    assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    assert.equal(item.link, undefined, 'no linked member');
    digestFile(join(root, name), item.sha256);
  }
  assert.deepEqual(inventory(root), expected, 'exact tree membership/modes/bytes');
}
export function readLoadManifest(path, digest, kind) {
  const manifest = JSON.parse(digestFile(path, digest));
  assert.equal(manifest.kind, kind, 'manifest kind');
  assert.equal(realpathSync(process.execPath), manifest.node.path, 'actual child binary');
  assert.equal(process.version, manifest.node.version);
  digestFile(manifest.node.path, manifest.node.sha256);
  assert.ok(Array.isArray(manifest.trees) && manifest.trees.length > 0);
  const allowed = new Map();
  for (const tree of manifest.trees) {
    assertInventory(tree.root, tree.files);
    for (const [name, item] of Object.entries(tree.files)) {
      const path = join(tree.root, name);
      assert.equal(allowed.has(path), false, 'nonoverlapping trees');
      allowed.set(path, item.sha256);
    }
  }
  for (const required of manifest.requiredFiles) assert.ok(allowed.has(required), `required member ${required}`);
  return { manifest, allowed };
}
export function parseArguments(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) refuse('explicit unique named arguments required');
    options[match[1]] = match[2];
  }
  const required = ['binding', 'binding-sha256', 'binding-commit', 'repository'];
  if (required.some(name => !options[name])) refuse('accepted STACK/candidate committed binding is HELD');
  if (Object.keys(options).some(name => !required.includes(name))) refuse('unknown admission argument');
  return options;
}
export function admitPacket(options) {
  const revision = options['binding-commit'];
  assert.match(revision, /^[a-f0-9]{40}$/u, 'no moving revision');
  const repository = realpathSync(options.repository);
  const path = options.binding;
  assert.match(path, /^tests\/shell\/dotglob-independent-20260828\/accepted-binding-[a-z0-9-]+\.json$/u);
  const bytes = git(repository, ['show', `${revision}:${path}`]);
  assert.equal(hash(bytes), options['binding-sha256'], 'committed packet digest');
  const packet = JSON.parse(bytes);
  assert.equal(packet.kind, 'dotglob-accepted-binding-v1');
  for (const key of ['acceptedStack', 'candidate', 'rootAuthorization']) assert.match(packet[key] ?? '', /^[a-f0-9]{40}$/u, `held ${key}`);
  assert.equal(packet.originalFreeze, '429766aaa9fee0be469ed79b186bc8e3b3ed43c2');
  assert.equal(packet.overlay, 'deced72dde70151b1b090fbba7d739323491cd89');
  assert.deepEqual(packet.productionAllowlist, ['src/shell/runtime.ts', 'src/shell/shell.ts']);
  for (const name of ['baseInputs', 'candidateInputs', 'packageInventory', 'sourceManifest', 'installedManifest', 'movedManifest', 'typeBinding', 'procedureBinding', 'tools']) {
    assert.ok(packet[name] && typeof packet[name] === 'object', `held ${name}`);
  }
  for (const name of packet.productionAllowlist) assert.ok(packet.baseInputs[name] && packet.candidateInputs[name], 'both production inputs explicitly selected');
  for (const [name, item] of Object.entries(packet.candidateInputs)) {
    assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    assert.match(item.revision, /^[a-f0-9]{40}$/u);
    const selected = git(repository, ['show', `${item.revision}:${name}`]);
    assert.equal(hash(selected), item.sha256, `candidate selected input ${name}`);
    const base = packet.baseInputs[name];
    assert.ok(base, 'no added source member');
    assert.match(base.revision, /^[a-f0-9]{40}$/u);
    assert.equal(hash(git(repository, ['show', `${base.revision}:${name}`])), base.sha256);
    if (!packet.productionAllowlist.includes(name)) assert.equal(item.sha256, base.sha256, `outside production write set ${name}`);
  }
  assert.deepEqual(Object.keys(packet.baseInputs).sort(), Object.keys(packet.candidateInputs).sort());
  return packet;
}
