import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assertTree, canonical, identity, newDirectory, readRegular, requireFact, safeRelative, sha256 } from './primitives.mjs';

function directories(root, manifest) {
  newDirectory(root, manifest.directories['']);
  for (const [suffix, mode] of Object.entries(manifest.directories).filter(([name]) => name).sort(([left], [right]) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
    mkdirSync(join(root, safeRelative(suffix)), { mode });
    chmodSync(join(root, suffix), mode);
  }
  chmodSync(root, manifest.directories['']);
}
export function copyTree(source, target, manifest) {
  assertTree(source, manifest);
  directories(target, manifest);
  for (const [suffix, descriptor] of Object.entries(manifest.files)) {
    const destination = join(target, safeRelative(suffix));
    copyFileSync(join(source, suffix), destination, 1);
    chmodSync(destination, descriptor.mode);
  }
  assertTree(source, manifest);
  assertTree(target, manifest);
  return target;
}
export function unpackArchive(archivePath, target, manifest, compressed, prefix) {
  const archive = readRegular(archivePath, 67108864);
  const bytes = compressed ? gunzipSync(archive, { maxOutputLength: 67108864 }) : archive;
  const members = new Map();
  let offset = 0;
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
  const octal = text => { requireFact(/^[0-7 ]*$/u.test(text), 'TAR_OCTAL'); return parseInt(text.trim() || '0', 8); };
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { requireFact(bytes.subarray(offset).every(byte => byte === 0), 'TAR_TRAILER'); break; }
    const checksum = octal(field(header, 148, 8));
    requireFact(header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0) === checksum, 'TAR_CHECKSUM');
    const rawName = [field(header, 345, 155), field(header, 0, 100)].filter(Boolean).join('/');
    requireFact(!prefix || rawName.startsWith(prefix), 'TAR_PREFIX');
    const name = safeRelative(prefix ? rawName.slice(prefix.length) : rawName);
    requireFact(header[156] === 0 || header[156] === 48, 'TAR_REGULAR_ONLY');
    const size = octal(field(header, 124, 12));
    const mode = octal(field(header, 100, 8));
    const descriptor = manifest.files[name];
    requireFact(descriptor && !members.has(name) && size === descriptor.bytes && mode === descriptor.mode && offset + 512 + size <= bytes.length, 'TAR_MEMBER', name);
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    requireFact(sha256(body) === descriptor.sha256, 'TAR_HASH', name);
    members.set(name, body);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  requireFact(canonical([...members.keys()].sort()) === canonical(Object.keys(manifest.files).sort()), 'TAR_MEMBERSHIP');
  directories(target, manifest);
  for (const [name, body] of members) { writeFileSync(join(target, name), body, { flag: 'wx', mode: manifest.files[name].mode }); chmodSync(join(target, name), manifest.files[name].mode); }
  assertTree(target, manifest);
  return target;
}
export function projectTree(source, target, manifest) {
  directories(target, manifest);
  for (const [name, descriptor] of Object.entries(manifest.files)) {
    const bytes = readRegular(join(source, name));
    requireFact(sha256(bytes) === descriptor.sha256 && bytes.length === descriptor.bytes, 'PROJECTION_BYTES');
    writeFileSync(join(target, name), bytes, { flag: 'wx', mode: descriptor.mode });
    chmodSync(join(target, name), descriptor.mode);
  }
  assertTree(target, manifest);
  return target;
}
export function applyVariant(root, manifest, variant, allowed) {
  requireFact(allowed && canonical(allowed) === canonical(variant), 'CONTROL_NOT_ENROLLED');
  const updated = structuredClone(manifest);
  const perFile = new Map();
  for (const edit of variant.edits) {
    safeRelative(edit.path);
    const text = perFile.get(edit.path) ?? readRegular(join(root, edit.path)).toString('utf8');
    requireFact(sha256(Buffer.from(text)) === edit.preSha256, 'MUTANT_PREIMAGE');
    requireFact(typeof edit.before === 'string' && edit.before.length > 0 && text.split(edit.before).length - 1 === edit.count, 'MUTANT_ANCHOR_COUNT');
    const result = text.split(edit.before).join(edit.after);
    requireFact(sha256(Buffer.from(result)) === edit.postSha256, 'MUTANT_POSTIMAGE');
    perFile.set(edit.path, result);
  }
  for (const [name, text] of perFile) {
    const bytes = Buffer.from(text);
    writeFileSync(join(root, name), bytes, { flag: 'w' });
    updated.files[name] = { ...updated.files[name], sha256: sha256(bytes), bytes: bytes.length };
  }
  assertTree(root, updated);
  return updated;
}
export function moveTree(staging, moved, manifest) {
  assertTree(staging, manifest);
  requireFact(!existsSync(moved) && dirname(staging) === dirname(moved), 'MOVE_DESTINATION');
  const before = identity(staging);
  renameSync(staging, moved);
  requireFact(!existsSync(staging) && canonical(identity(moved)) === canonical(before), 'PHYSICAL_MOVE');
  assertTree(moved, manifest);
  return { staging, root: moved, originIdentity: before, moved: true };
}
