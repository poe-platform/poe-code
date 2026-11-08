import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const owned = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(owned, '../../../..');
export const engines = ['virtual-bash', 'just-bash'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const same = isDeepStrictEqual;
export const hashPattern = /^[a-f0-9]{64}$/u;

export function contained(root, file) {
  const path = relative(root, file);
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith('../');
}

export function safeRelative(path) {
  assert.ok(typeof path === 'string' && path && !isAbsolute(path));
  assert.ok(!path.split('/').some(part => !part || part === '.' || part === '..'));
  return path;
}

export async function regularBytes(file, maximum = 64 * 1024 * 1024) {
  const metadata = await lstat(file);
  assert.ok(metadata.isFile() && metadata.size <= maximum, `not bounded regular file: ${file}`);
  assert.equal(await realpath(file), resolve(await realpath(dirname(file)), basename(file)), `file alias: ${file}`);
  return readFile(file);
}

export async function json(file) {
  return JSON.parse((await regularBytes(file)).toString('utf8'));
}

export function bytes(value) {
  assert.equal(typeof value, 'string', 'missing byte capture');
  const decoded = Buffer.from(value, 'base64');
  assert.equal(decoded.toString('base64'), value, 'noncanonical base64 capture');
  return decoded;
}

export function compareRaw(expected, observed) {
  assert.ok(observed && typeof observed === 'object', 'missing observation');
  assert.ok(Number.isInteger(observed.exitCode), 'missing integer exit code');
  for (const capture of [expected, observed]) {
    assert.ok(capture.entries && typeof capture.entries === 'object' && !Array.isArray(capture.entries));
    for (const [path, entry] of Object.entries(capture.entries)) {
      safeRelative(path);
      assert.ok(['file', 'directory', 'symlink'].includes(entry.type), `unsupported captured type: ${path}`);
      if (entry.type === 'file') bytes(entry.bytes);
      if (entry.type === 'symlink') assert.equal(typeof entry.target, 'string');
    }
  }
  const fields = {
    stdout: bytes(expected.stdout).equals(bytes(observed.stdout)),
    stderr: bytes(expected.stderr).equals(bytes(observed.stderr)),
    exitCode: expected.exitCode === observed.exitCode,
    entries: same(expected.entries, observed.entries),
  };
  const historicalEquality = Object.keys(fields).every(field => JSON.stringify(expected[field]) === JSON.stringify(observed[field]));
  const pass = Object.values(fields).every(Boolean);
  return { pass, fields, serializationDisagreement: historicalEquality !== pass };
}

export async function emitReport(report, output) {
  const text = JSON.stringify(report, null, 2) + '\n';
  if (output) {
    const target = resolve(output);
    assert.ok(contained(owned, target), 'output must be a NEW file inside owned verification subtree');
    assert.ok(contained(owned, await realpath(dirname(target))) || await realpath(dirname(target)) === owned);
    await writeFile(target, text, { flag: 'wx' });
  } else process.stdout.write(text);
}
