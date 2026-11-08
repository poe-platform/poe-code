import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { durable, digest } from './a01.mjs';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const REPO = path.resolve(ROOT, '../../../..');
export const SOURCE = '0ec84fc38c3fafd75776d80148d4f3c2d77e6247';
export const EVIDENCE = '01f8826628b6ba070498e6b833f9a1597d2db375';
export const BASE = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
export const NODE = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const PREFIX = 'tests/commands/xan-module-review-20260828/actual-review-v1/';
export const gitReceipts = [];
export async function git(args, bound) {
  const child = spawn('/usr/bin/git', args, { cwd: REPO, env: { PATH: '', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const pieces = []; let size = 0; let errorSize = 0; let overflow = false;
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  const streams = Promise.all([ (async () => { for await (const chunk of child.stdout) { size += chunk.length; if (size > bound) { overflow = true; child.kill('SIGKILL'); } else pieces.push(Buffer.from(chunk)); } })(),
    (async () => { for await (const chunk of child.stderr) { errorSize += chunk.length; if (errorSize > 16384) child.kill('SIGKILL'); } })() ]);
  try {
    const outcome = await closed; await streams;
    gitReceipts.push({ args, bound, bytes: size, stderrBytes: errorSize, ...outcome, overflow, reaped: true });
    assert.equal(outcome.code, 0, `git ${args[0]}`); assert.equal(overflow, false); return Buffer.concat(pieces, size);
  }
  finally { clearTimeout(timer); }
}
export async function identity(filename, bound = Number.MAX_SAFE_INTEGER) {
  const info = await lstat(filename); assert.ok(info.isFile() && !info.isSymbolicLink()); assert.ok(info.size <= bound);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename, { highWaterMark: 65536 })) { bytes += chunk.length; assert.ok(bytes <= bound); hash.update(chunk); }
  assert.equal(bytes, info.size); return { bytes, sha256: hash.digest('hex'), mode: (info.mode & 0o777).toString(8) };
}
export async function tree(root) {
  const result = [];
  async function visit(directory, prefix) {
    for (const name of (await readdir(directory)).sort()) {
      const filename = path.join(directory, name); const relative = prefix + name; const info = await lstat(filename);
      assert.ok(!info.isSymbolicLink());
      if (info.isDirectory()) { result.push({ path: `${relative}/`, directory: true }); await visit(filename, `${relative}/`); }
      else result.push({ path: relative, ...await identity(filename) });
    }
  }
  await visit(root, ''); return result;
}
export async function verifyTree(root, entries) { assert.deepEqual(await tree(root), entries, `append-aware integrity ${root}`); }
export async function writeSelected(root, name, bytes, mode = 0o644) {
  assert.ok(!name.split('/').includes('..') && !path.isAbsolute(name) && !name.endsWith('AGENTS.md'));
  const filename = path.join(root, name); await mkdir(path.dirname(filename), { recursive: true });
  const file = await open(filename, 'wx', mode); try { await file.writeFile(bytes); } finally { await file.close(); }
}
export async function metadata() {
  const name = 'tests/commands/xan-author-20260828/core/evidence/06-final-green.receipt.json';
  const raw = await git(['show', `${EVIDENCE}:${name}`], 336194);
  assert.equal(raw.length, 336194); assert.equal(digest(raw), '923a51f88ece8d96969333d7fab62e1e599719c51c39475b02d9759163f95b9f');
  const receipt = JSON.parse(raw);
  assert.equal(receipt.base, BASE); assert.equal(receipt.candidate, SOURCE);
  assert.equal(receipt.baselineManifest.length, 215); assert.equal(receipt.candidateProduct.length, 10);
  assert.equal(receipt.compositionManifest.length, 225); assert.equal(receipt.toolManifest.length, 313); assert.equal(receipt.movedPackageManifest.length, 885);
  for (const [name, expected] of [['baseline', '591ba6d6d4a83f9910c3906853af664a00904abaca9a0c243386861d15fe553f'],
    ['composition', '4ec398bc4ae2bbbc15eb0a63b796192619087e9d0e25b8c87524ac7dff9f7df0'],
    ['tool', '79f08addf060bc7ddd85d7be442db4e5c63ee444a6e893d72ca16d3b5baf7227'],
    ['movedPackage', '225d2710a79c003795f501370ff8662828657bed500933572f5a10fae92831ec']]) {
    assert.equal(receipt[`${name}Identity`], expected);
    const inventory = receipt[`${name}Manifest`];
    assert.equal(digest(JSON.stringify(inventory)), expected, `content inventory ${name}`);
  }
  return receipt;
}
export async function assemble(work, evidence) {
  const receipt = await metadata();
  await mkdir(work); await mkdir(path.join(work, 'source')); await mkdir(path.join(work, 'tools'));
  const node = await identity(NODE); assert.equal(node.sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  const baselineTree = (await git(['ls-tree', '-rz', BASE, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'], 131072)).toString().split('\0').filter(Boolean).map(line => {
    const [descriptor, filename] = line.split('\t'); const [mode, type, blob] = descriptor.split(' '); return { path: filename, mode, type, blob };
  }).filter(entry => /^src\/.*\.ts$/.test(entry.path) || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(entry.path));
  assert.deepEqual(baselineTree.map(entry => entry.path), receipt.baselineManifest.map(entry => entry.path));
  const sources = [...receipt.baselineManifest, ...receipt.candidateProduct];
  const observed = [];
  for (const entry of sources) {
    assert.equal(entry.mode, '100644'); assert.equal(entry.revision, entry.path.startsWith('src/commands/xan/') ? SOURCE : BASE);
    const descriptor = (await git(['ls-tree', entry.revision, '--', entry.path], 1024)).toString().trim();
    assert.equal(descriptor, `${entry.mode} blob ${entry.blob}\t${entry.path}`);
    const raw = await git(['cat-file', 'blob', entry.blob], entry.bytes);
    assert.equal(raw.length, entry.bytes); assert.equal(digest(raw), entry.sha256);
    await writeSelected(path.join(work, 'source'), entry.path, raw);
    observed.push({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 });
  }
  observed.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.deepEqual(new Map(observed.map(entry => [entry.path, entry])), new Map(receipt.compositionManifest.map(entry => [entry.path, entry])));
  const tools = [];
  for (const entry of receipt.toolManifest) {
    assert.ok(entry.path.startsWith('node_modules/') && !entry.path.includes('AGENTS.md'));
    const actual = await identity(path.join(REPO, entry.path), entry.bytes);
    assert.equal(actual.bytes, entry.bytes); assert.equal(actual.sha256, entry.sha256);
    const destination = path.join(work, 'tools', entry.path); await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(REPO, entry.path), destination, 1); await chmod(destination, parseInt(actual.mode, 8));
    assert.deepEqual(await identity(destination, entry.bytes), actual); tools.push({ path: entry.path, ...actual });
  }
  const archive = '/tmp/xan-module-author-20260828-pack-daFbtp/virtual-bash-0.0.0.tgz';
  const packed = await identity(archive, 760439); assert.equal(packed.bytes, 760439); assert.equal(packed.sha256, '324268096450f0133265b7003140139fc5118e9e4a39d43ca856ce214918bac7');
  await copyFile(archive, path.join(evidence, 'virtual-bash-0.0.0.tgz'), 1);
  const installed = path.join(work, 'install-staging'); await mkdir(installed);
  await unpack(path.join(evidence, 'virtual-bash-0.0.0.tgz'), installed, receipt.movedPackageManifest);
  const beforeMove = await tree(installed); await rename(installed, path.join(work, 'installed-moved'));
  await assert.rejects(lstat(installed), { code: 'ENOENT' }); await verifyTree(path.join(work, 'installed-moved'), beforeMove);
  const binding = { source: await tree(path.join(work, 'source')), tools: await tree(path.join(work, 'tools')), installed: beforeMove, node, packed,
    completeInputCount: sources.length, baseSourceCount: baselineTree.filter(entry => entry.path.endsWith('.ts')).length,
    sourceCommit: SOURCE, base: BASE, compositionIdentity: receipt.compositionIdentity,
    artifactAuthentication: 'EXACT author pack retained and extracted; not independently serialized npm pack',
    archiveExclusions: 'Historical baseline/tools tar bytes not available/bound here; independently authenticate selected Git/tool content instead' };
  await durable(path.join(evidence, 'ADMISSION.json'), binding); return { receipt, binding };
}
async function unpack(filename, destination, manifest) {
  const remaining = new Map(manifest.map(entry => [`package/${entry.path}`, entry]));
  let pending = Buffer.alloc(0); let size = 0; let padding = 0; let active; let file; let hash; let total = 0; let zeros = 0; let unpacked = 0;
  const stream = createReadStream(filename, { highWaterMark: 65536 }).pipe(createGunzip());
  try {
    for await (const chunk of stream) {
      total += chunk.length; assert.ok(total <= 6291456, 'finite tar transport envelope from 885 members and declared file bytes');
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        if (active) {
          const count = Math.min(size, pending.length); const fragment = pending.subarray(0, count);
          await file.writeFile(fragment); hash.update(fragment); size -= count; pending = pending.subarray(count); unpacked += count;
          if (size) break;
          await file.close(); file = undefined; assert.equal(hash.digest('hex'), active.sha256); active = undefined;
        } else if (padding) { const count = Math.min(padding, pending.length); pending = pending.subarray(count); padding -= count; }
        else {
          if (pending.length < 512) break;
          const header = pending.subarray(0, 512); pending = pending.subarray(512);
          if (header.every(byte => byte === 0)) { zeros++; continue; }
          assert.equal(zeros, 0); const text = (start, count) => header.subarray(start, start + count).toString().replace(/\0.*$/s, '');
          const name = `${text(345, 155) ? `${text(345, 155)}/` : ''}${text(0, 100)}`;
          assert.ok(['0', ''].includes(text(156, 1)), 'regular files only, no symlink/PAX/AGENTS');
          active = remaining.get(name); assert.ok(active, `unexpected tar member ${name}`); remaining.delete(name);
          size = parseInt(text(124, 12).trim(), 8); assert.equal(size, active.bytes); assert.equal(parseInt(text(100, 8).trim(), 8), 0o644);
          const target = path.join(destination, active.path); assert.ok(target.startsWith(`${destination}/`)); await mkdir(path.dirname(target), { recursive: true });
          file = await open(target, 'wx', 0o644); hash = createHash('sha256'); padding = (512 - size % 512) % 512;
          if (size === 0) { await file.close(); file = undefined; assert.equal(hash.digest('hex'), active.sha256); active = undefined; }
        }
      }
    }
    assert.equal(remaining.size, 0); assert.equal(pending.length, 0); assert.equal(active, undefined); assert.equal(padding, 0); assert.ok(zeros >= 2);
    assert.equal(unpacked, 4249513);
  } finally { stream.destroy(); if (file) await file.close(); }
}
