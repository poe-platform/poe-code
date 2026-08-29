import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const directory = path.dirname(new URL(import.meta.url).pathname);
const [work, sealFile] = process.argv.slice(2);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(await fs.readFile(sealFile, 'utf8'));
async function authenticated(name) {
  const filename = path.join(directory, name);
  const stat = await fs.lstat(filename);
  const authority = seal.files[name];
  assert.ok(authority && stat.isFile() && stat.size === authority.bytes);
  const bytes = await fs.readFile(filename);
  assert.equal(digest(bytes), authority.sha256);
  return bytes;
}
for (const name of Object.keys(seal.files)) await authenticated(name);
const { admitPackage } = await import(pathToFileURL(path.join(directory, 'package-admission.mjs')));
const { validateTar } = await import(pathToFileURL(path.join(directory, 'parse-manifest.mjs')));
const authority = JSON.parse(await authenticated('ARTIFACT.json'));
const expected = JSON.parse(await authenticated('EXPECTED-MEMBERS.json'));
const results = [];
const baseline = Buffer.from('0123456789abcdef');
const tinyAuthority = { bytes: baseline.length, sha256: digest(baseline), decodedLimit: 32 };
const specs = [
  ['C01', 'tampered', 'HASH'], ['C02', 'short', 'SIZE'], ['C03', 'oversized', 'SIZE'],
  ['C04', 'wronghash', 'HASH'], ['C05', 'directory', 'TYPE'], ['C06', 'symlink', 'TYPE'],
  ['C07', 'replacepath', 'MUTATION'], ['C08', 'mutatesource', ['MUTATION', 'HASH']],
  ['C09', 'truncateafterread', 'MUTATION'], ['C10', 'aggregate', 'AGGREGATE'],
  ['C11', 'orderingmutant', 'HASH'], ['C12', 'restored', 'HASH'],
];
for (const [id, kind, expectedCode] of specs) {
  const filename = path.join(work, id);
  const counts = { decoder: 0, parser: 0, extraction: 0 };
  const events = [];
  const ledger = { current: 0, peak: 0, maximum: kind === 'aggregate' ? 40 : 4096 };
  const selected = { ...tinyAuthority };
  let operation = admitPackage;
  const options = {
    events, parseReserve: 16,
    decode(bytes) { counts.decoder++; return bytes; },
    parse(bytes) { counts.parser++; return bytes.length; },
  };
  let primaryPresent = false;
  let reason;
  try {
    if (kind === 'directory') await fs.mkdir(filename);
    else if (kind === 'symlink') { await fs.writeFile(filename + '.target', baseline, { flag: 'wx' }); await fs.symlink(filename + '.target', filename); }
    else await fs.writeFile(filename, kind === 'short' ? baseline.subarray(1) : kind === 'oversized' ? Buffer.concat([baseline, Buffer.from('x')]) : kind === 'tampered' ? Buffer.from('x123456789abcdef') : baseline, { flag: 'wx' });
    if (['wronghash', 'orderingmutant', 'restored'].includes(kind)) selected.sha256 = '0'.repeat(64);
    if (kind === 'replacepath') options.afterOpen = async () => { await fs.rename(filename, filename + '.original'); await fs.writeFile(filename, baseline, { flag: 'wx' }); };
    if (kind === 'mutatesource') options.afterOpen = async () => { await fs.writeFile(filename, Buffer.from('x123456789abcdef')); };
    if (kind === 'truncateafterread') options.afterRead = async () => { await fs.truncate(filename, 1); };
    if (kind === 'orderingmutant' || kind === 'restored') {
      const moduleName = kind === 'orderingmutant' ? 'ordering-mutant.mjs' : 'restored-admission.mjs';
      await authenticated(moduleName);
      operation = (await import(pathToFileURL(path.join(directory, moduleName)))).admitPackage;
    }
    try { await operation(filename, selected, ledger, options); }
    catch (caught) { primaryPresent = true; reason = caught; }
    assert.equal(primaryPresent, true);
    assert.ok([expectedCode].flat().includes(reason?.code), `${id}: ${reason?.stack}`);
    assert.equal(counts.decoder, kind === 'orderingmutant' ? 1 : 0);
    assert.equal(counts.parser, 0);
    assert.equal(counts.extraction, 0);
    assert.equal(ledger.current, 0);
    results.push({ id, kind, status: 'PASS', reasonCode: reason.code, counts, events, ledger, primaryPresent });
  } catch (caught) {
    results.push({ id, kind, status: 'FAIL', reason: String(caught?.stack ?? caught), counts, events, ledger, primaryPresent });
  } finally {
    for (const suffix of ['', '.original', '.target']) await fs.rm(filename + suffix, { recursive: true, force: true });
  }
  console.log(JSON.stringify(results.at(-1)));
}
let artifactResult = { status: 'UNRUN' };
if (results.every(result => result.status === 'PASS')) {
  const counts = { decoder: 0, parser: 0, extraction: 0 };
  const events = [];
  const ledger = { current: 0, peak: 0, maximum: 96 * 1024 * 1024 };
  try {
    const result = await admitPackage(authority.path, authority, ledger, {
      events,
      decode(bytes, options) { counts.decoder++; return gunzipSync(bytes, options); },
      parse(bytes) { counts.parser++; return validateTar(bytes, expected); },
    });
    assert.deepEqual(counts, { decoder: 1, parser: 1, extraction: 0 });
    assert.equal(ledger.current, 0);
    artifactResult = { status: 'PASS', ...result, counts, events, ledger };
  } catch (reason) { artifactResult = { status: 'FAIL', reason: String(reason?.stack ?? reason), counts, events, ledger }; }
}
for (const name of Object.keys(seal.files)) await authenticated(name);
const output = { controls: results, artifact: artifactResult, productImports: 0, extractionCalls: 0, workerLaunches: 0, childLaunches: 0 };
await fs.writeFile(path.join(work, 'RESULT.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ artifact: artifactResult }));
if (results.some(result => result.status !== 'PASS') || artifactResult.status !== 'PASS') process.exitCode = 1;
