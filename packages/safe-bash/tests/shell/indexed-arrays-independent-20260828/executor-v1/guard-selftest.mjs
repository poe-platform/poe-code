import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { digest, tarInventory, admit } from './boundary.mjs';
import { supervise } from './supervisor.mjs';
const directory = fileURLToPath(new URL('.', import.meta.url));
const work = mkdtempSync(join(directory, '.synthetic-guards-')); const identity = lstatSync(work);
const rows = []; const children = []; let cleanup;
const check = (id, fn) => { try { fn(); rows.push({ id, pass: true }); } catch (error) { rows.push({ id, pass: false, error: String(error) }); } };
const tar = (name, type = '0', duplicate = false) => {
  const body = Buffer.from('literal data'); const header = Buffer.alloc(512);
  header.write('package/' + name, 0); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
  header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257); header.write('00', 263);
  header.write(header.reduce((total, byte) => total + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  const record = Buffer.concat([header, body, Buffer.alloc(512 - body.length)]);
  return gzipSync(Buffer.concat([record, ...(duplicate ? [record] : []), Buffer.alloc(1024)]));
};
try {
  const packageRoot = join(work, 'package'); const sourceRoot = join(work, 'source'); mkdirSync(packageRoot); mkdirSync(sourceRoot);
  const literal = 'export const synthetic = 41;\n';
  for (const mode of ['normal', 'tampered', 'missing', 'unbound', 'source-fallback', 'null-source']) {
    const target = join(mode === 'source-fallback' ? sourceRoot : packageRoot, `${mode}.mjs`);
    if (mode !== 'missing') writeFileSync(target, mode === 'tampered' ? literal + '\n' : literal);
    const packet = { packageRoot, harnessRoot: directory, target, nullSource: mode === 'null-source', allowed: mode === 'unbound' ? [] : [[target, digest(Buffer.from(literal))]] };
    const packetPath = join(work, `${mode}.json`); writeFileSync(packetPath, JSON.stringify(packet));
    const run = await supervise(process.execPath, [join(directory, 'guard-worker.mjs'), packetPath], { cwd: work, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 3000 });
    children.push({ mode, run });
    check(`actual-hook:${mode}`, () => {
      assert.ok(run.closeObserved && run.groupAbsent && !run.fault);
      assert.equal(run.code, mode === 'normal' ? 0 : 78);
      if (mode === 'normal') assert.ok(run.stdout.includes('"syntheticGuard"') && run.stdout.includes(digest(Buffer.from(literal))));
      else assert.equal(run.stdout.includes('"syntheticGuard"'), false);
    });
  }
  check('regular-tar-data', () => assert.deepEqual(Object.keys(tarInventory(tar('unit.mjs'))), ['unit.mjs']));
  check('linked-tar-refused', () => assert.throws(() => tarInventory(tar('unit.mjs', '2'))));
  check('tar-traversal-refused', () => assert.throws(() => tarInventory(tar('../escape'))));
  check('duplicate-tar-refused', () => assert.throws(() => tarInventory(tar('unit.mjs', '0', true))));
  check('synthetic-kind-not-product', () => {
    const path = join(work, 'not-product.json'); const bytes = Buffer.from('{"kind":"synthetic"}'); writeFileSync(path, bytes);
    assert.throws(() => admit(path, digest(bytes), '/not-used', '0'.repeat(64)), /synthetic cannot be a product manifest/u);
  });
} finally {
  assert.equal(lstatSync(work).ino, identity.ino); assert.equal(lstatSync(work).dev, identity.dev);
  if (children.every(child => child.run.closeObserved && child.run.groupAbsent)) { rmSync(work, { recursive: true }); cleanup = { path: work, absent: !existsSync(work) }; }
  else cleanup = { path: work, absent: false };
}
console.log(JSON.stringify({ role: 'synthetic loader and tar-data checks only; no product import', rows, children, cleanup,
  counts: { controls: rows.length, passed: rows.filter(row => row.pass).length, children: children.length, arrayBodies: 0, nativeCases: 0, productMutantKills: 0 },
  bindings: ['boundary.mjs','guard-worker.mjs','guard-selftest.mjs','supervisor.mjs'].map(path => ({ path, sha256: digest(readFileSync(join(directory, path))) })) }, null, 2));
if (rows.some(row => !row.pass) || !cleanup.absent) process.exitCode = 1;
