import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

export function requireFact(condition, code, unsafe = true) {
  if (!condition) throw Object.assign(new Error(code), { code, unsafe });
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonical(value) {
  const ordered = entry => Array.isArray(entry) ? entry.map(ordered) : entry !== null && typeof entry === 'object' ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, ordered(entry[key])])) : entry;
  return JSON.stringify(ordered(value));
}

export function equal(actual, expected, code, unsafe = true) {
  requireFact(canonical(actual) === canonical(expected), code, unsafe);
}

export function safeRelative(path) {
  requireFact(typeof path === 'string' && path.length > 0 && path.length <= 1024, 'RELATIVE_PATH');
  requireFact(path.split('/').every(part => /^[A-Za-z0-9_@.+-]+$/u.test(part) && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(part) && part.toLowerCase() !== 'agents.md'), 'UNSAFE_OR_AGENTS_PATH');
  return path;
}

export function inside(root, path) {
  if (typeof root !== 'string' || typeof path !== 'string' || !isAbsolute(root) || !isAbsolute(path) || resolve(root) !== root || resolve(path) !== path) return false;
  const suffix = relative(root, path);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

export async function directory(path, mode = 493) {
  requireFact(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'ABSOLUTE_DIRECTORY');
  const stat = await lstat(path);
  requireFact(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path && (mode === null || (stat.mode & 4095) === mode), 'DIRECTORY_IDENTITY');
  return stat;
}

export async function regularBytes(path, maximum, expected = null) {
  requireFact(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'ABSOLUTE_FILE');
  const before = await lstat(path);
  requireFact(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= maximum && await realpath(path) === path, 'REGULAR_FILE_IDENTITY');
  const bytes = await readFile(path);
  const after = await lstat(path);
  for (const key of ['ino', 'dev', 'mode', 'size', 'mtimeMs', 'ctimeMs', 'nlink']) requireFact(before[key] === after[key], 'FILE_CHANGED_DURING_READ');
  requireFact(bytes.length === before.size, 'FILE_READ_SIZE');
  const identity = { sha256: sha256(bytes), bytes: bytes.length, mode: before.mode & 4095 };
  if (expected !== null) equal(identity, expected, 'FILE_EXPECTED_IDENTITY');
  return { bytes, identity };
}

export function directoriesFor(files) {
  const directories = { '': 493 };
  for (const path of Object.keys(files)) {
    safeRelative(path);
    let parent = posix.dirname(path);
    while (parent !== '.') { requireFact(!Object.hasOwn(files, parent), 'FILE_DIRECTORY_ALIAS'); directories[parent] = 493; parent = posix.dirname(parent); }
  }
  return directories;
}

export function validateManifest(manifest, bounds, nodeRelative = null) {
  requireFact(manifest && typeof manifest === 'object', 'MANIFEST');
  equal(Object.keys(manifest).sort(), ['directories', 'files'], 'MANIFEST_KEYS');
  equal(manifest.directories, directoriesFor(manifest.files), 'MANIFEST_DIRECTORIES');
  let retainedBytes = 0;
  requireFact(Object.keys(manifest.files).length + Object.keys(manifest.directories).length <= bounds.treeEntries, 'TREE_ENTRY_BOUND');
  for (const [path, entry] of Object.entries(manifest.files)) {
    safeRelative(path);
    equal(Object.keys(entry).sort(), ['bytes', 'mode', 'sha256'], 'FILE_DESCRIPTOR_KEYS');
    requireFact(/^[a-f0-9]{64}$/u.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && Number.isSafeInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 4095, 'FILE_DESCRIPTOR');
    requireFact(entry.bytes <= (path === nodeRelative ? bounds.nodeBytes : bounds.fileBytes), 'FILE_SIZE_BOUND');
    if (path !== nodeRelative) retainedBytes += entry.bytes;
  }
  requireFact(retainedBytes <= bounds.treeBytes, 'TREE_BYTES_BOUND');
}

export async function snapshot(root, bounds, nodeRelative = null) {
  const files = {}, directories = {};
  let entries = 0, retainedBytes = 0;
  const visit = async path => {
    const absolute = path ? join(root, path) : root;
    const before = await directory(absolute);
    directories[path] = before.mode & 4095;
    requireFact(++entries <= bounds.treeEntries, 'TREE_ENTRY_BOUND');
    const children = (await readdir(absolute)).sort();
    for (const name of children) {
      const child = path ? `${path}/${name}` : name;
      safeRelative(child);
      const childPath = join(root, child), stat = await lstat(childPath);
      requireFact(!stat.isSymbolicLink(), 'TREE_SYMLINK');
      if (stat.isDirectory()) await visit(child);
      else {
        requireFact(++entries <= bounds.treeEntries, 'TREE_ENTRY_BOUND');
        const value = await regularBytes(childPath, child === nodeRelative ? bounds.nodeBytes : bounds.fileBytes);
        files[child] = value.identity;
        if (child !== nodeRelative) retainedBytes += value.identity.bytes;
        requireFact(retainedBytes <= bounds.treeBytes, 'TREE_BYTES_BOUND');
      }
    }
    equal((await readdir(absolute)).sort(), children, 'DIRECTORY_MEMBERSHIP_CHANGED');
    const after = await directory(absolute);
    requireFact(before.ino === after.ino && before.dev === after.dev && before.mode === after.mode, 'DIRECTORY_CHANGED');
  };
  await visit('');
  return { files, directories };
}

export async function assertTree(root, expected, bounds, nodeRelative = null) {
  validateManifest(expected, bounds, nodeRelative);
  const actual = await snapshot(root, bounds, nodeRelative);
  equal(actual, expected, 'TREE_BYTES_MODES_MEMBERSHIP');
  return actual;
}

export async function freshDirectory(path) {
  await mkdir(path, { mode: 493 });
  await directory(path);
}

export async function writeFresh(path, bytes, expected = null) {
  await writeFile(path, bytes, { flag: 'wx', mode: 420 });
  const identity = expected ?? { sha256: sha256(bytes), bytes: bytes.length, mode: 420 };
  return (await regularBytes(path, 16777216, identity)).identity;
}

export async function guard(api) {
  requireFact((await api.guard())?.integrity === true, 'CORE_INTEGRITY');
}

export function validateApi(api) {
  requireFact(api?.version === 'yq-b8-core-worker-v1', 'CORE_VERSION');
  for (const method of ['phase', 'note', 'writeJson', 'writeBytes', 'runTool', 'guard', 'readBoundJson']) requireFact(typeof api[method] === 'function', 'CORE_CAPABILITY');
  const request = api.request;
  requireFact(request?.schema === 1 && Object.isFrozen(request) && Object.isFrozen(request.bindings), 'FROZEN_REQUEST');
  requireFact(typeof request.nonce === 'string' && request.nonce.length >= 16, 'CORE_NONCE');
  requireFact(request.bindings.candidate === 'b8f5d60d75452e1dd181167fb87abd995221f6e3', 'CANDIDATE');
  requireFact(request.job?.id === 'BUILD-SUCCESSOR' && request.job.phase === 'BUILD' && request.job.role === 'independent-build' && request.job.slotCapMs === 300000 && request.job.maxCompilerDescendants === 1, 'BUILD_SLOT');
  for (const name of ['rootGoSha256', 'recipeSha256']) requireFact(/^[a-f0-9]{64}$/u.test(request[name] ?? '') && !/^0+$/u.test(request[name]), 'ROOT_RECIPE_AUTHORITY');
  for (const name of ['globalNs', 'phaseNs', 'jobNs', 'workNs']) requireFact(/^[1-9][0-9]*$/u.test(request.deadline?.[name] ?? ''), 'PARENT_DEADLINE');
  requireFact(['globalNs', 'phaseNs', 'jobNs'].every(name => BigInt(request.deadline.workNs) <= BigInt(request.deadline[name])), 'DEADLINE_ORDER');
  return request;
}
