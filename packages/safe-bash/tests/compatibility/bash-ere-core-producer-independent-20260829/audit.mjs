import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const owned = 'tests/compatibility/bash-ere-core-producer-independent-20260829';
const packet = 'tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (name, cap = 16 * 1024 * 1024) => {
  const stat = fs.lstatSync(name);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, name);
  const bytes = fs.readFileSync(name);
  assert.equal(bytes.length, stat.size, name);
  return bytes;
};
const json = name => JSON.parse(read(name));
const report = { schema: 1, started: new Date().toISOString(), checks: [], controls: [], findings: [], decoded: 0, productEvaluations: 0, workers: 0, nativeChildren: 0 };
const check = async (name, body) => { try { const detail = await body(); report.checks.push({ name, status: 'PASS', detail }); } catch (error) { report.checks.push({ name, status: 'HOLD', error: String(error) }); } };
const control = async (name, body) => { try { await body(); report.controls.push({ name, status: 'PASS' }); } catch (error) { report.controls.push({ name, status: 'FAIL', error: String(error) }); } };
const bind = (row, filename = row.path) => { const bytes = read(filename); assert.equal(bytes.length, row.size ?? row.bytes, filename); assert.equal(digest(bytes), row.sha256, filename); if (typeof row.mode === 'number') assert.equal(fs.lstatSync(filename).mode & 0o777, row.mode, filename); return bytes; };
const admitArchive = bytes => { assert.equal(bytes.length, 909885); assert.equal(digest(bytes), 'fc559bb3a1bd7db72e959461ce2b733871cde0867095c61fd065021fb498606d'); return bytes; };
const archive = admitArchive(read(`${packet}/output/package/virtual-bash-0.0.0.tgz`, 909885));
const predecode = read(`${packet}/output/PRE-INFLATE-RECEIPT.json`, 821512);
assert.equal(digest(predecode), '52b75de5a8b9af27effc7d5dcf5ffa64eeb8171383413810709143b144fef54d');
const shipping = json(`${packet}/output/SHIPPING.json`);
const guardBytes = read(`${packet}/output/CORE-GUARD-PRESEAL.json`);
assert.equal(digest(guardBytes), 'e832b9cf2342c99d09a785f801ae4c73f5905a3d349c9efbc2818e6955c1f66e');
const seal = JSON.parse(guardBytes);
const decoded = zlib.gunzipSync(archive, { maxOutputLength: 6 * 1024 * 1024 });
report.decoded++;
const members = new Map();
await check('same-authenticated-buffer-tar', () => {
  let offset = 0;
  while (offset + 512 <= decoded.length) {
    const header = decoded.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) { assert(decoded.subarray(offset).every(value => value === 0)); break; }
    const text = (begin, end) => header.subarray(begin, end).toString('utf8').replace(/\0.*$/s, '');
    const octal = (begin, end) => { const value = text(begin, end).trim(); assert(/^[0-7]+$/.test(value)); return parseInt(value, 8); };
    const expected = octal(148, 156);
    let sum = 0;
    for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(sum, expected);
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join('/');
    assert(name.startsWith('package/') && !name.split('/').some(part => part === '..' || part === '.') && !members.has(name));
    assert(['0', ''].includes(text(156, 157)), `nonregular ${name}`);
    const size = octal(124, 136);
    assert(size <= 1024 * 1024 && offset + 512 + size <= decoded.length);
    const bytes = decoded.subarray(offset + 512, offset + 512 + size);
    members.set(name.slice(8), { bytes, size, mode: octal(100, 108), sha256: digest(bytes) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(members.size, 1002);
  assert.equal(shipping.rows.length, 1002);
  for (const row of shipping.rows) { const member = members.get(row.path); assert(member, row.path); assert.equal(member.size, row.size); assert.equal(member.sha256, row.sha256); assert.equal(member.mode & 0o777, row.mode); }
  return { compressed: archive.length, decoded: decoded.length, members: members.size, bytes: [...members.values()].reduce((sum, row) => sum + row.size, 0), extraction: false };
});
await check('private-static-and-worker-url-edges', () => {
  const privateRows = shipping.rows.filter(row => row.path.startsWith('dist/commands/regex-execution/ere/'));
  assert.equal(privateRows.length, 48);
  const staticEdges = [], workerEdges = [];
  for (const row of privateRows.filter(row => row.path.endsWith('.js'))) {
    const source = members.get(row.path).bytes.toString('utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(row.path), match[1]));
      assert(members.has(target), target); staticEdges.push({ from: row.path, specifier: match[1], target });
    }
    for (const match of source.matchAll(/new URL\(['"]([^'"]+)['"],\s*import\.meta\.url\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(row.path), match[1]));
      assert(members.has(target), target); workerEdges.push({ from: row.path, specifier: match[1], target });
    }
  }
  assert.equal(staticEdges.length, 29); assert.equal(workerEdges.length, 1); assert(workerEdges[0].target.endsWith('/worker.js'));
  return { assets: privateRows.length, staticEdges, workerEdges, oldCombinedClassification: 30 };
});
const expectedChanges = ['owner', 'root'].flatMap(name => ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => `dist/commands/regex-execution/ere/transport/${name}${extension}`));
const verifyEmits = rows => { assert.equal(rows.length, 1000); const changed = rows.filter(row => row.status !== 'unchanged').map(row => row.path).sort(); assert.deepEqual(changed, [...expectedChanges].sort()); for (const row of rows) { assert.equal(row.before.sha256 === row.after.sha256, row.status === 'unchanged'); assert.equal(row.after.sha256, members.get(row.path).sha256); } };
const emits = json(`${packet}/output/FULL-EMIT-DIFF.json`);
await check('full-emit-causality', () => { verifyEmits(emits.rows); return { total: 1000, unchanged: 992, changed: expectedChanges, failedV2Causes: json(`${packet}/output/EMIT-CAUSES.json`) }; });
await check('source-composition-and-type-tool-pins', () => {
  const source = json(`${packet}/output/SOURCE-ADMISSION.json`);
  assert.deepEqual(source.selection, { inputs: 305, changed: 2, unchanged: 303 });
  assert.equal(seal.sourceInputs.length, 305);
  for (const row of source.rows) bind(row, `${packet}/output/source/${row.path}`);
  for (const row of seal.sourceInputs) { const bytes = read(`${packet}/output/source/${row.path}`); assert.equal(digest(bytes), row.sha256); assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.blob); }
  const types = json(`${packet}/TYPE-TOOLS.json`);
  assert.equal(types.rows.length, 115);
  const compositionPath = path.resolve(packet, '../COMPOSITION.json');
  const composition = json(compositionPath);
  assert.equal(digest(read(compositionPath)), 'f8004c83c2316ce33e5e93719961b56847c87b6c47b79566b2810c92e8ef72f9');
  const originalRecords = [];
  const collect = value => { if (value && typeof value === 'object') { if (typeof value.path === 'string' && typeof value.sha256 === 'string') originalRecords.push(value); for (const child of Object.values(value)) collect(child); } };
  collect(composition.tools.typescript);
  for (const row of types.rows) { bind(row); bind(row, row.origin); const original = originalRecords.find(item => item.path === row.origin); assert(original, `original pin ${row.origin}`); assert.equal(original.sha256, row.sha256); assert.equal(original.size, row.size); assert.equal(original.mode, row.mode); }
  return { sourceRows: source.rows.length, typeRows: types.rows.length, typeBytes: types.rows.reduce((sum, row) => sum + row.size, 0), overlay: seal.sourceInputs.filter(row => row.origin !== 'frozen-base') };
});
await check('strict-build-and-offline-pack-receipts', () => {
  for (const name of ['strict-build', 'offline-pack']) { const row = json(`${packet}/output/${name}.json`); assert.deepEqual(row.exit, { code: 0, signal: null }); assert.deepEqual(row.close, row.exit); assert(row.retired && row.stdoutEOF && row.stderrEOF && row.primaryPresent === false); bind(row.stdout); bind(row.stderr); if (name === 'strict-build') assert.equal(row.bytes.stdout + row.bytes.stderr, 0); else assert(row.args.includes('--offline') && row.args.includes('--ignore-scripts')); }
  return { newCompilerInvocations: 0, newPackInvocations: 0, authenticatedHistoricalBuilds: 1, authenticatedHistoricalPacks: 1 };
});
await check('three-data-layout-complete-census', () => {
  const results = [];
  for (const layout of seal.layouts) {
    const manifest = JSON.parse(bind(layout.manifest));
    const rows = manifest.rows;
    const seen = [];
    const walk = directory => { for (const name of fs.readdirSync(directory)) { const filename = path.join(directory, name); const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) walk(filename); else { assert(stat.isFile()); seen.push(path.relative(layout.app, filename)); } } };
    walk(layout.app);
    assert.deepEqual(seen.sort(), rows.map(row => row.path).sort());
    for (const row of rows) bind(row, path.join(layout.app, row.path));
    const productRows = rows.filter(row => row.path.startsWith('package/'));
    for (const row of shipping.rows) { const found = productRows.find(item => item.path === `package/${row.path}`); assert(found, row.path); assert.equal(found.sha256, row.sha256); }
    assert.equal(layout.cells.length, 70);
    results.push({ name: layout.name, app: layout.app, files: rows.length, productFiles: productRows.length, bytes: manifest.bytes, cells: layout.cells.length });
  }
  return results;
});
const clockFile = `${packet}/output/controller/core-guard-v8.mjs`;
const clockPin = seal.controller.find(row => row.path === path.resolve(clockFile));
assert(clockPin); bind(clockPin);
const { createCoreClock, runCoreSchedule } = await import(pathToFileURL(path.resolve(clockFile)).href);
await control('C01-compressed-tamper-before-decode', () => { const changed = Buffer.from(archive); changed[100] ^= 1; assert.throws(() => admitArchive(changed)); });
await control('C02-compressed-size-before-decode', () => assert.throws(() => admitArchive(archive.subarray(1))));
await control('C03-unrelated-emit-rejected', () => { const changed = structuredClone(emits.rows); changed[0].status = 'changed'; assert.throws(() => verifyEmits(changed)); });
await control('C04-eight-output-kinds-preserved', () => verifyEmits(emits.rows));
await control('C05-clock-backwards-refused', () => { const clock = createCoreClock({ started: 100, now: () => 99 }); assert.throws(() => clock.remaining()); });
await control('C06-exact-reservation-boundary', () => { const clock = createCoreClock({ started: 0, now: () => 1619998 }); assert.equal(clock.admit({ requiredCaseMilliseconds: 1, cleanupMilliseconds: 1 }).admitted, true); });
await control('C07-insufficient-reservation-unrun', () => { const clock = createCoreClock({ started: 0, now: () => 1619999 }); assert.equal(clock.admit({ requiredCaseMilliseconds: 1, cleanupMilliseconds: 1 }).status, 'UNRUN'); });
await control('C08-falsy-primary-and-cleanup-preserved', async () => { let launches = 0; const result = await runCoreSchedule({ cells: [{ id: 'first' }, { id: 'second' }], started: 0, now: () => 0, requiredCaseMilliseconds: () => 1, cleanupMilliseconds: () => 1, runCase: async () => { launches++; throw undefined; }, cleanupCase: async () => { throw false; }, publish: async () => {} }); assert.equal(launches, 1); assert.equal(result[0].primaryPresent, true); assert.equal(result[0].primary, undefined); assert.deepEqual(result[0].secondary, [false]); assert.equal(result[1].status, 'UNRUN'); });
const cases = json(`${packet}/output/CASES-v4.json`);
report.ordinaryRows = cases.rows.filter(row => /^R\d\d$/.test(row.id));
report.structure = { shipping: Object.fromEntries(Object.entries(shipping).filter(([key]) => key !== 'rows')), guard: Object.fromEntries(Object.entries(seal).filter(([key]) => !['sourceInputs', 'layouts', 'controller'].includes(key))), layoutFirstCell: seal.layouts[0].cells[0], layoutNames: seal.layouts.map(row => Object.keys(row)), caseCount: cases.rows.length, caseOriginal: cases.original };
report.finished = new Date().toISOString();
report.verdict = report.checks.every(row => row.status === 'PASS') && report.controls.every(row => row.status === 'PASS') ? 'PRODUCER_DATA_ACCEPT' : 'PRODUCER_DATA_HOLD';
fs.writeFileSync(`${owned}/AUDIT.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verdict: report.verdict, checks: report.checks.map(({ name, status, error, detail }) => ({ name, status, error, detail: name.includes('census') ? detail : undefined })), controls: report.controls, structure: report.structure }, null, 2));
for (const row of report.ordinaryRows) console.log(JSON.stringify(row));
