import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runChild } from '../current-shell/support.mjs';
import { hostCases } from './cases.mjs';
import { observeHost } from './host.mjs';

export async function captureHosts(moduleUrl) {
  assert.ok(moduleUrl.startsWith('file:'));
  const rows = [];
  for (const specimen of hostCases) {
    const args = ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', moduleUrl, specimen.id];
    const env = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CURRENT_SHELL_IMPORT_TRACE: '' };
    const result = await runChild(process.execPath, args, { env, deadline: 3000 });
    let observation = null;
    try { observation = JSON.parse(Buffer.from(result.stdout, 'base64').toString('utf8')); } catch {}
    rows.push({ id: specimen.id, executable: process.execPath, args, env, deadlineMs: 3000, outputCapBytes: 1048576, result, observation, pass: result.status === 0 && result.signal === null && !result.timedOut && !result.overflow && !result.groupAlive && result.stderr === '' && observation?.pass === true });
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--child') {
    const library = await import(process.argv[3]);
    console.log(JSON.stringify(await observeHost(library, process.argv[4])));
  } else {
    assert.equal(process.argv.length, 4, 'Usage: node host-runner.mjs ABSOLUTE_INJECTED_MODULE NEW_OUTPUT.json (only after author READY and source guards)');
    const moduleUrl = pathToFileURL(resolve(process.argv[2])).href;
    const rows = await captureHosts(moduleUrl);
    const { saveNewJson } = await import('./native.mjs');
    saveNewJson(process.argv[3], { capturedAt: new Date().toISOString(), moduleUrl, sourceGuard: 'Caller must supply an independent before/import/after source guard; this driver alone establishes none.', rows });
    console.log(JSON.stringify({ controls: rows.length, passing: rows.filter(row => row.pass).length }));
  }
}
