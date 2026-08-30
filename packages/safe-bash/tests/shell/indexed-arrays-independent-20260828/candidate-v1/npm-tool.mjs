import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function data(value, keys) {
  assert.ok(value !== null && typeof value === 'object');
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), 'exact own data keys');
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'), 'no accessor');
}
function sequence(value) {
  assert.ok(Array.isArray(value) && value.length <= 10000);
  data(value, [...Array(value.length).keys()].map(String).concat('length'));
}
function normalized(filename) {
  assert.equal(typeof filename, 'string');
  assert.ok(filename.length > 0 && filename.length <= 4096 && !filename.includes('\0'));
  assert.ok(filename.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
}
export function resolveInventory(entries) {
  sequence(entries);
  const table = new Map();
  let previous = '';
  for (const entry of entries) {
    const descriptor = Object.getOwnPropertyDescriptor(entry, 'kind');
    assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
    assert.ok(['directory', 'file', 'link'].includes(descriptor.value));
    const keys = descriptor.value === 'file' ? ['path', 'kind', 'mode', 'bytes', 'sha256'] : descriptor.value === 'link' ? ['path', 'kind', 'mode', 'target'] : ['path', 'kind', 'mode'];
    data(entry, keys); normalized(entry.path);
    assert.ok(entry.path > previous, 'unique sorted entries'); previous = entry.path;
    assert.ok(Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o7777);
    if (entry.kind === 'file') {
      assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 128 * 1024 * 1024);
      assert.equal(typeof entry.sha256, 'string'); assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
    }
    if (entry.kind === 'link') {
      assert.equal(typeof entry.target, 'string');
      assert.ok(entry.target.length > 0 && entry.target.length <= 4096 && !path.isAbsolute(entry.target) && !entry.target.includes('\0'), 'relative bound link');
    }
    table.set(entry.path, entry);
  }
  for (const entry of entries) {
    const parent = path.posix.dirname(entry.path);
    assert.ok(parent === '.' || table.get(parent)?.kind === 'directory', 'every physical parent is a directory');
  }
  return Array.from(entries).filter(entry => entry.kind === 'link').map(link => {
    const queue = link.path.split('/'), stack = [], seen = new Set();
    let steps = 0;
    while (queue.length) {
      assert.ok(++steps <= 4096, 'finite link resolution');
      const part = queue.shift();
      if (part === '.' || part === '') continue;
      if (part === '..') { assert.ok(stack.length > 0, 'link never leaves admitted tool tree'); stack.pop(); continue; }
      const filename = [...stack, part].join('/'), entry = table.get(filename);
      assert.ok(entry, 'every resolved component is bound');
      if (entry.kind === 'link') {
        assert.ok(!seen.has(filename), 'acyclic links'); seen.add(filename);
        assert.ok(seen.size <= 32, 'bounded links'); queue.unshift(...entry.target.split('/'));
      } else {
        if (queue.length) assert.equal(entry.kind, 'directory', 'directory traversal');
        stack.push(part);
      }
    }
    const target = table.get(stack.join('/'));
    assert.equal(target?.kind, 'file', 'link target is bound regular file');
    return { path: link.path, mode: link.mode, text: link.target, resolved: target.path, targetMode: target.mode, targetBytes: target.bytes, targetSha256: target.sha256 };
  });
}
function scan(root) {
  assert.equal(typeof root, 'string'); assert.equal(path.resolve(root), root);
  assert.equal(fs.realpathSync(root), root, 'canonical tool root');
  const rootStat = fs.lstatSync(root); assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  const entries = []; let total = 0;
  const visit = (directory, depth) => {
    assert.ok(depth <= 32);
    const names = fs.readdirSync(directory).sort(); assert.ok(names.length <= 10000);
    for (const name of names) {
      assert.notEqual(name, 'AGENTS.md'); assert.ok(entries.length < 10000);
      const filename = path.join(directory, name), stat = fs.lstatSync(filename);
      const entry = { path: path.relative(root, filename), kind: '', mode: stat.mode & 0o7777 };
      if (stat.isSymbolicLink()) entries.push({ ...entry, kind: 'link', target: fs.readlinkSync(filename) });
      else if (stat.isDirectory()) { entries.push({ ...entry, kind: 'directory' }); visit(filename, depth + 1); }
      else {
        assert.ok(stat.isFile(), 'regular tool payload'); total += stat.size; assert.ok(total <= 128 * 1024 * 1024);
        assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename), 'no linked physical parent');
        const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev);
          const bytes = fs.readFileSync(descriptor); assert.equal(bytes.length, stat.size);
          entries.push({ ...entry, kind: 'file', bytes: bytes.length, sha256: hash(bytes) });
        } finally { fs.closeSync(descriptor); }
      }
    }
  };
  visit(root, 0); entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { root, rootMode: rootStat.mode & 0o7777, entries };
}
function physicalLinks(root, links) {
  for (const link of links) assert.equal(fs.realpathSync(path.join(root, link.path)), path.join(root, link.resolved), 'physical resolution equals bound contained target');
}
export function captureTool(root, approvedLinks) {
  const scanned = scan(root);
  assert.deepEqual(scanned.entries.filter(entry => entry.kind === 'link').map(entry => ({ path: entry.path, mode: entry.mode, target: entry.target })), approvedLinks, 'exact previously approved aliases before following');
  const links = resolveInventory(scanned.entries); physicalLinks(root, links);
  return { ...scanned, links };
}
export function verifyTool(expected) {
  data(expected, ['root', 'rootMode', 'entries', 'links']);
  const links = resolveInventory(expected.entries);
  sequence(expected.links); assert.equal(expected.links.length, links.length);
  for (let index = 0; index < links.length; index++) {
    data(expected.links[index], Object.keys(links[index]));
    for (const key of Object.keys(links[index])) assert.equal(expected.links[index][key], links[index][key], 'link metadata derived from complete inventory');
  }
  const actual = scan(expected.root);
  assert.deepEqual(actual, { root: expected.root, rootMode: expected.rootMode, entries: Array.from(expected.entries, entry => ({ ...entry })) }, 'exact append-aware npm closure before following');
  physicalLinks(expected.root, links);
  return expected;
}
