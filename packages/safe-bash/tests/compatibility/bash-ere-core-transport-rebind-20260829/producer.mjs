import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateComposition, fullEmitDelta } from './recipe.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (filename, maximum = 16777216) => { const stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= maximum, 'regular bounded input'); const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes; };
function verifyFile(row, filename = row.path) {
  const stat = fs.lstatSync(filename); assert(stat.isFile()); assert.equal(stat.size, row.size ?? row.bytes);
  const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(65536), descriptor = fs.openSync(filename, 'r');
  try { let count; while ((count = fs.readSync(descriptor, buffer))) digest.update(buffer.subarray(0, count)); } finally { fs.closeSync(descriptor); }
  assert.equal(digest.digest('hex'), row.sha256, filename);
}
function inventory(root) {
  const rows = []; let total = 0;
  const walk = directory => { for (const name of fs.readdirSync(directory).sort()) { const filename = path.join(directory, name), stat = fs.lstatSync(filename); if (stat.isDirectory()) walk(filename); else { assert(stat.isFile()); total += stat.size; assert(total < 201326592 && rows.length < 10000); rows.push({ path: path.relative(root, filename), bytes: stat.size, mode: stat.mode & 511, sha256: hash(read(filename)) }); } } };
  walk(root); return rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
function writeJson(filename, value, frozen = false) { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: frozen ? 0o444 : 0o600 }); return hash(bytes); }

export function executeProducer(arguments_) {
  const [mode, expectedPreseal, grantPath, expectedGrant, outputRoot, expectedFrozenReceipt] = arguments_;
  assert(['produce', 'decode-frozen'].includes(mode));
  assert(/^[a-f0-9]{64}$/.test(expectedPreseal ?? '') && /^[a-f0-9]{64}$/.test(expectedGrant ?? ''));
  assert(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile(), 'outer raw captures required before admission');
  const sealBytes = read(path.join(own, 'PRESEAL.json')); assert.equal(hash(sealBytes), expectedPreseal);
  const seal = JSON.parse(sealBytes);
  for (const row of seal.files) verifyFile(row, path.join(own, row.path));
  const grantBytes = read(grantPath, 16384); assert.equal(hash(grantBytes), expectedGrant);
  const grant = JSON.parse(grantBytes);
  assert.equal(grant.action, mode === 'produce' ? 'PRODUCE-CORE-TWO-SOURCE-OVERLAY' : 'DECODE-FROZEN-CORE-PRODUCER-ARCHIVE');
  assert.equal(grant.presealSha256, expectedPreseal);
  assert(/^[a-f0-9]{40}$/.test(grant.independentProducerReview) && /^[a-f0-9]{40}$/.test(grant.transportSourceReview));
  assert.equal(grant.outputRoot, outputRoot);
  assert(path.isAbsolute(outputRoot) && path.dirname(outputRoot) === own, 'new directly owned output root only');
  const composition = JSON.parse(read(path.join(own, 'COMPOSITION.json')));
  assert.equal(grant.composition, composition.derivedTree);
  const baselineBytes = read(composition.baseSourceManifest.path); assert.equal(hash(baselineBytes), composition.baseSourceManifest.sha256);
  validateComposition(composition, JSON.parse(baselineBytes));
  const tools = composition.tools;
  assert.equal(process.execPath, tools.node.path);
  verifyFile(tools.node); verifyFile(tools.git);
  for (const row of tools.typescript) verifyFile(row);
  for (const row of tools.npm.rows) {
    const filename = path.join(tools.npmRoot, row.path);
    if (row.kind === 'link') { assert(fs.lstatSync(filename).isSymbolicLink()); assert.equal(fs.readlinkSync(filename), row.text); verifyFile({ size: row.targetSize, sha256: row.targetSha256 }, fs.realpathSync(filename)); }
    else verifyFile(row, filename);
  }
  if (mode === 'decode-frozen') {
    assert(/^[a-f0-9]{64}$/.test(expectedFrozenReceipt ?? ''));
    const receiptPath = path.join(outputRoot, 'PRE-INFLATE-RECEIPT.json');
    const receiptBytes = read(receiptPath); assert.equal(hash(receiptBytes), expectedFrozenReceipt);
    assert.equal(fs.lstatSync(receiptPath).mode & 0o222, 0);
    const receipt = JSON.parse(receiptBytes); assert.equal(receipt.composition, composition.derivedTree);
    assert.equal(grant.frozenReceiptSha256, expectedFrozenReceipt);
    assert.equal(fs.lstatSync(receipt.archive.path).mode & 0o222, 0);
    const archiveBuffer = read(receipt.archive.path); assert.equal(archiveBuffer.length, receipt.archive.bytes); assert.equal(hash(archiveBuffer), receipt.archive.sha256);
    const decoded = gunzipSync(archiveBuffer, { maxOutputLength: 67108864 });
    const members = []; let offset = 0;
    while (offset + 512 <= decoded.length) {
      const header = decoded.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
      const string = bytes => bytes.toString('utf8').replace(/\0.*$/s, '');
      const name = string(header.subarray(0, 100)), prefix = string(header.subarray(345, 500));
      const full = prefix ? prefix + '/' + name : name;
      assert(full.startsWith('package/') && !full.split('/').includes('..'));
      const storedChecksum = Number.parseInt(string(header.subarray(148, 156)).trim(), 8);
      let computedChecksum = 0;
      for (let index = 0; index < 512; index++) computedChecksum += index >= 148 && index < 156 ? 32 : header[index];
      assert.equal(storedChecksum, computedChecksum, 'tar header checksum');
      assert(header[156] === 0 || header[156] === 48, 'regular package member');
      const size = Number.parseInt(string(header.subarray(124, 136)).trim(), 8); assert(Number.isSafeInteger(size) && size >= 0);
      const bytes = decoded.subarray(offset + 512, offset + 512 + size); assert.equal(bytes.length, size);
      members.push({ path: full.slice(8), bytes: size, sha256: hash(bytes) }); offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert(offset + 1024 <= decoded.length && decoded.subarray(offset).every(byte => byte === 0), 'complete zero trailer');
    assert.equal(new Set(members.map(row => row.path)).size, members.length);
    const expected = new Map(receipt.shipping.map(row => [row.path, row])); assert.equal(members.length, expected.size);
    for (const row of members) { assert(expected.has(row.path)); assert.equal(row.bytes, expected.get(row.path).bytes); assert.equal(row.sha256, expected.get(row.path).sha256); }
    writeJson(path.join(outputRoot, 'DECODE-RESULT.json'), { receiptSha256: expectedFrozenReceipt, archiveSha256: hash(archiveBuffer), decodedBytes: decoded.length, members, sourceOrProductImported: false });
    return;
  }
  assert(!fs.existsSync(outputRoot), 'fresh clean root only'); fs.mkdirSync(outputRoot, { mode: 0o700 });
  const sourceRoot = path.join(outputRoot, 'source'), typesRoot = path.join(outputRoot, 'empty-types');
  for (const directory of [sourceRoot, typesRoot, path.join(outputRoot, 'package'), path.join(outputRoot, 'home'), path.join(outputRoot, 'tmp'), path.join(outputRoot, 'cache')]) fs.mkdirSync(directory);
  const userConfig = path.join(own, 'user.npmrc'), globalConfig = path.join(own, 'global.npmrc');
  assert.notEqual(userConfig, globalConfig); assert.equal(read(userConfig).length, 0); assert.equal(read(globalConfig).length, 0);
  const env = { PATH: path.dirname(tools.node.path), HOME: path.join(outputRoot, 'home'), TMPDIR: path.join(outputRoot, 'tmp'), LANG: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_cache: path.join(outputRoot, 'cache'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  const started = Date.now(), receipts = []; let captureBytes = 0;
  const child = (id, executable, args, input, cwd = sourceRoot) => {
    assert(Date.now() - started + 120000 < 900000, 'producer publication reserve');
    const result = spawnSync(executable, args, { cwd, env, input, timeout: Math.min(120000, 900000 - 120000 - (Date.now() - started)), maxBuffer: 8388608 });
    for (const channel of ['stdout', 'stderr']) { const bytes = result[channel] ?? Buffer.alloc(0); captureBytes += bytes.length; assert(captureBytes <= 33554432); fs.writeFileSync(path.join(outputRoot, id + '.' + channel), bytes, { flag: 'wx' }); }
    receipts.push({ id, executable, args, cwd, pid: result.pid, status: result.status, signal: result.signal, error: result.error ? String(result.error) : null });
    writeJson(path.join(outputRoot, id + '.json'), receipts.at(-1));
    assert(!result.error && result.status === 0 && result.signal === null, id + ' refused'); return result.stdout;
  };
  const batch = child('source-blobs', tools.git.path, ['cat-file', '--batch'], composition.sources.map(row => row.blob).join('\n') + '\n', process.cwd());
  let offset = 0;
  for (const row of composition.sources) {
    const newline = batch.indexOf(10, offset), header = batch.subarray(offset, newline).toString().split(' ');
    assert.equal(header[0], row.blob); assert.equal(header[1], 'blob'); assert.equal(Number(header[2]), row.bytes);
    const bytes = batch.subarray(newline + 1, newline + 1 + row.bytes); assert.equal(hash(bytes), row.sha256); assert.equal(batch[newline + 1 + row.bytes], 10);
    const filename = path.join(sourceRoot, row.path); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: Number.parseInt(row.mode, 8) & 511 }); offset = newline + row.bytes + 2;
  }
  assert.equal(offset, batch.length);
  const compiler = tools.typescript.find(row => row.path.endsWith('/lib/tsc.js')); assert(compiler);
  child('clean-build', tools.node.path, [compiler.path, '-p', path.join(sourceRoot, 'tsconfig.build.json'), '--typeRoots', typesRoot]);
  const actual = inventory(sourceRoot);
  for (const row of composition.sources) verifyFile(row, path.join(sourceRoot, row.path));
  const compiledBytes = read(composition.compiledManifest.path); assert.equal(hash(compiledBytes), composition.compiledManifest.sha256);
  const delta = fullEmitDelta(JSON.parse(compiledBytes).rows, actual);
  writeJson(path.join(outputRoot, 'FULL-EMIT-DIFF.json'), { rows: delta, counts: { total: delta.length, changed: delta.filter(row => row.status === 'changed').length, added: delta.filter(row => row.status === 'added').length, removed: delta.filter(row => row.status === 'removed').length }, allSourceMapsAndDeclarationsIncluded: true, acceptance: 'independent review required; no assumed two-output-file closure' });
  const shipping = actual.filter(row => row.path === 'README.md' || row.path === 'package.json' || row.path.startsWith('dist/'));
  const packed = JSON.parse(child('pack', tools.node.path, [path.join(tools.npmRoot, 'bin/npm-cli.js'), 'pack', '--offline', '--ignore-scripts', '--json', '--userconfig=' + userConfig, '--globalconfig=' + globalConfig, '--pack-destination=' + path.join(outputRoot, 'package')]).toString());
  assert.equal(packed.length, 1); assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const archivePath = path.join(outputRoot, 'package', packed[0].filename), archive = read(archivePath);
  fs.chmodSync(archivePath, 0o444);
  const frozen = { schema: 'core-overlay-producer-pre-inflate-v1', composition: composition.derivedTree, sourceInputs: composition.sources, actualInventory: actual, shipping, archive: { path: archivePath, bytes: archive.length, sha256: hash(archive) }, emitDiffSha256: hash(read(path.join(outputRoot, 'FULL-EMIT-DIFF.json'))), receipts, beforeInflation: true, noProductExecution: true };
  const receiptSha256 = writeJson(path.join(outputRoot, 'PRE-INFLATE-RECEIPT.json'), frozen, true);
  writeJson(path.join(outputRoot, 'FROZEN.json'), { receiptSha256, archiveSha256: frozen.archive.sha256, decodeRequiresSeparateExactHashGrant: true }, true);
  console.log(JSON.stringify({ phase: 'FROZEN_BEFORE_ANY_DECODE', receiptSha256, archiveSha256: frozen.archive.sha256, shippingMembers: shipping.length, emittedFiles: delta.length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) executeProducer(process.argv.slice(2));
