import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path));
const capture = json(join(here, 'CAPTURE.json'));
const manifest = json(join(here, 'RAW-MANIFEST.json'));
const temporary = mkdtempSync(join(tmpdir(), 'alias-v2-capture-verification-'));
try {
  const bytes = Buffer.from(readFileSync(join(here, 'raw-capture.tar.gz.b64'), 'utf8'), 'base64');
  assert.equal(bytes.length, capture.bytes);
  assert.equal(hash(bytes), capture.sha256);
  const archive = join(temporary, 'capture.tar.gz');
  writeFileSync(archive, bytes);
  const names = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(names.every(name => !name.startsWith('/') && !name.split('/').includes('..')));
  const directory = join(temporary, 'raw');
  mkdirSync(directory);
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', directory]);
  const files = [];
  function walk(root, prefix = '') {
    for (const name of readdirSync(root).sort()) {
      const path = join(root, name), relative = prefix ? prefix + '/' + name : name, stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(path, relative);
      else { assert.equal(stat.isFile(), true); const content = readFileSync(path); files.push({ path: relative, bytes: content.length, sha256: hash(content) }); }
    }
  }
  walk(directory);
  assert.deepEqual(files, manifest.files);
  assert.equal(files.length, capture.files);
  assert.equal(json(join(directory, 'REVIEW.json')).candidate, capture.candidate);
  assert.equal(capture.candidate, '0123c83d3aae72a15621acbb29a165b97b2c6ab6');
  const cleanup = json(join(directory, 'cleanup.json'));
  assert.equal(cleanup.ownedResourcesRemoved, true);
  assert.equal(cleanup.foreignPathsRemoved, false);
  assert.equal(cleanup.workersCreated, 91);
  assert.equal(cleanup.workersExited, 91);
  execFileSync(process.execPath, [join(here, 'inspect-results.mjs'), directory, '--verify'], { stdio: 'pipe' });
  console.log(JSON.stringify({ status: 'capture-verified', candidate: capture.candidate, files: files.length, base: '77/77', supplement: '5/5', productExecutions: 0 }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
