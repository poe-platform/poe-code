import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCases, hostCases } from './cases.mjs';
import { batchSize } from './product-child.mjs';
import { owned, root, environment, sourceGuard, runChild, sha256, patchJson } from './support.mjs';

export async function runProduct(dependencies = { sourceGuard, runChild }) {
  const frozenBytes = await readFile(resolve(owned, 'native-frozen.json'));
  assert.equal(sha256(frozenBytes), '7bc5b049a98609f4b1218f1cbdee6e96e0bf65fa1fac567688d35168867ce4a3', 'Native freeze must remain byte-identical');
  const frozen = JSON.parse(frozenBytes.toString());
  const fixturesSha256 = sha256(await readFile(resolve(owned, 'cases.mjs')));
  assert.equal(fixturesSha256, frozen.fixturesSha256, 'Frozen fixture definition must remain unchanged');
  const primary = frozen.profiles.find(profile => profile.role === 'PRIMARY');
  const historical = frozen.profiles.find(profile => profile.role === 'HISTORICAL');
  assert.equal(primary.results.length, nativeCases.length);
  assert.equal(historical.results.length, nativeCases.length);
  const report = { generatedAt: new Date().toISOString(), expectationsCommit: '0934888', fixturesSha256, frozenSha256: sha256(await readFile(resolve(owned, 'native-frozen.json'))), rows: [] };
  const fixtures = [...nativeCases, ...hostCases];
  for (let offset = 0; offset < fixtures.length; offset += batchSize) {
    const batch = fixtures.slice(offset, offset + batchSize);
    const before = await dependencies.sourceGuard();
    const processResult = await dependencies.runChild(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', resolve(owned, 'product-child.mjs'), '--batch', ...batch.map(fixture => fixture.id)], { env: { ...environment, CURRENT_SHELL_SOURCE_GUARD: before.sha256 }, deadline: 8000 });
    const after = await dependencies.sourceGuard();
    let children;
    try { children = JSON.parse(Buffer.from(processResult.stdout, 'base64').toString()); } catch { children = null; }
    const complete = Array.isArray(children) && children.length === batch.length && children.every((child, index) => child?.id === batch[index].id);
    for (const [index, fixture] of batch.entries()) {
      const child = complete ? children[index] : null;
      const valid = processResult.status === 0 && !processResult.signal && !processResult.timedOut && !processResult.overflow && !processResult.groupAlive && before.sha256 === after.sha256 && child?.sourceGuard?.stable === true && child?.sourceGuard?.before?.sha256 === before.sha256 && child?.sourceGuard?.after?.sha256 === after.sha256 && child?.fixtureSha256 === fixturesSha256;
      const nativeExpected = primary.results.find(row => row.id === fixture.id);
      const historicalExpected = historical.results.find(row => row.id === fixture.id);
      const equal = expected => {
        try { assert.deepEqual(child?.observation, expected); return true; } catch { return false; }
      };
      const row = { id: fixture.id, cohort: fixture.kind ? 'host-contract' : 'native-parity', valid, passed: valid && (fixture.kind ? child.observation?.passed === true : equal(nativeExpected.comparable)), ...(fixture.kind ? {} : { historicalMatch: valid && equal(historicalExpected.comparable), expected: nativeExpected.comparable }), process: processResult, child, sourceGuard: { before, after, stable: before.sha256 === after.sha256 } };
      report.rows.push(row);
      process.stderr.write(`${row.passed ? 'PASS' : 'FAIL'} ${row.id}${valid ? '' : ' INVALID-GUARD/PROCESS'}\n`);
    }
  }
  report.summary = Object.fromEntries(['native-parity', 'host-contract'].map(cohort => {
    const rows = report.rows.filter(row => row.cohort === cohort);
    return [cohort, { total: rows.length, passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, invalid: rows.filter(row => !row.valid).length }];
  }));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(root, process.argv[1])) {
  const report = await runProduct();
  if (process.argv[2]) patchJson(process.argv[2], report);
  else process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stderr.write(`${JSON.stringify(report.summary)}\n`);
  if (report.rows.some(row => !row.passed)) process.exitCode = 1;
}
