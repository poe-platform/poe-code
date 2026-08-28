import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blob, controls, directory, inventory, pins, sha } from './bind.mjs';
import { copyRegular } from './workspace.mjs';
import { child } from './series.mjs';

controls();
const root = `${directory}/load-controls-01`; mkdirSync(root); mkdirSync(`${root}/records`);
const binding = JSON.parse(readFileSync(`${directory}/BINDING.json`)); const route = JSON.parse(readFileSync(`${directory}/ROOT-ROUTE-v2.json`));
assert.equal(route.authorization, 'ROOT_EXECUTION_AUTHORIZED'); assert.equal(route.bindingSha256, sha(JSON.stringify(binding)));
const outside = `${root}/actual-unadmitted-runtime.ts`; writeFileSync(outside, blob(pins.candidate, 'src/shell/runtime.ts')); assert.equal(sha(readFileSync(outside)), binding.runtime.sha256);
const tools = `${directory}/tool-inputs`; const toolsBefore = inventory(tools);
const source = `${directory}/attempt-02/source-retained`;
const moved = `${directory}/continuation-03/physically-moved-consumer`;
const installed = `${directory}/continuation-03/installed-consumer`;
assert(!existsSync(installed)); const originalMoved = inventory(moved);
const record = (name, value) => writeFileSync(`${root}/records/${name}.json`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const results = [];
const runMode = async (mode, client, packageRoot) => {
  const before = inventory(client); const packageBefore = inventory(packageRoot);
  copyRegular(`${directory}/full-load-entry.mjs`, `${client}/full-load-entry.mjs`);
  const admittedClient = inventory(client);
  const allowed = Object.fromEntries([client, packageRoot, tools].flatMap(base => Object.entries(inventory(base)).filter(([, entry]) => entry.kind === 'file').map(([path, entry]) => [resolve(base, path), entry.sha256])));
  const relative = mode === 'source' ? ['src/index.ts', 'src/shell/runtime.ts', 'src/fs/webdav/webdav.ts'] : ['dist/index.js', 'dist/shell/runtime.js', 'dist/fs/webdav/webdav.js'];
  const negatives = [{ kind: 'outside', path: outside, expected: 'LOAD_OUTSIDE' }, ...relative.map((path, index) => ({ kind: ['missing', 'runtime', 'provider'][index], path: `${packageRoot}/${path}`, expected: index === 0 ? 'missing-entry' : 'LOAD_HASH' }))];
  record(`${mode}-before`, { client: before, admittedClient, package: packageBefore, outsideHash: sha(readFileSync(outside)) });
  try {
    for (const negative of negatives) {
      const name = `${mode}-${negative.kind}`; const original = negative.kind === 'outside' ? undefined : readFileSync(negative.path); const stash = `${root}/records/${name}-held`;
      const config = { authorization: route.authorization, binding, route, mode, consumer: client, packageRoot, compiler: `${tools}/typescript/lib/typescript.js`, allowed, negative, resultPath: `${root}/records/${name}-result.json` };
      const configPath = `${root}/records/${name}-config.json`; writeFileSync(configPath, JSON.stringify(config));
      try {
        if (negative.kind === 'missing') renameSync(negative.path, stash);
        else if (original) writeFileSync(negative.path, Buffer.concat([original, Buffer.from('\nADMISSION_NEGATIVE_ONLY\n')]));
        const capture = await child(`${tools}/node/node`, [`${client}/full-load-entry.mjs`, configPath], { cwd: client, env: { PATH: `${tools}/node`, HOME: root, TMPDIR: root, CD_REVIEW_CONFIG_SHA256: sha(readFileSync(configPath)) } });
        record(`${name}-child`, capture); assert(capture.naturalSettlement && capture.cleanupClean && !capture.groupStillPresent); assert.equal(capture.status, 0);
        const result = JSON.parse(readFileSync(config.resultPath)); assert.equal(result.classification, 'actual-public-root-import-admission-negative');
        if (negative.kind === 'outside') assert.equal(result.loaded.length, 0);
        results.push({ mode, kind: negative.kind, status: 'pass', actualExistingOutside: negative.kind === 'outside', actualPublicRootImport: negative.kind !== 'outside', loadedBeforeAdmissionFailure: result.loaded.length });
      } finally {
        if (negative.kind === 'missing' && existsSync(stash)) renameSync(stash, negative.path); else if (original) writeFileSync(negative.path, original);
      }
      assert.deepEqual(inventory(client), admittedClient); assert.deepEqual(inventory(packageRoot), packageBefore); assert.deepEqual(inventory(tools), toolsBefore); controls();
    }
  } finally {
    assert.equal(sha(readFileSync(`${client}/full-load-entry.mjs`)), sha(readFileSync(`${directory}/full-load-entry.mjs`))); unlinkSync(`${client}/full-load-entry.mjs`);
  }
  assert.deepEqual(inventory(client), before); assert.deepEqual(inventory(packageRoot), packageBefore); record(`${mode}-after`, { client: inventory(client), package: inventory(packageRoot) });
};
const sourceClient = `${root}/source-consumer`; mkdirSync(sourceClient); writeFileSync(`${sourceClient}/package.json`, JSON.stringify({ type: 'module', private: true }));
await runMode('source', sourceClient, source);
renameSync(moved, installed); assert(!existsSync(moved)); assert.deepEqual(inventory(installed), originalMoved);
try { await runMode('installed', installed, `${installed}/node_modules/virtual-bash`); }
finally { renameSync(installed, moved); }
assert(!existsSync(installed)); assert.deepEqual(inventory(moved), originalMoved);
await runMode('moved', moved, `${moved}/node_modules/virtual-bash`); assert.deepEqual(inventory(moved), originalMoved);
record('SUMMARY', { qualification: 'Twelve actual imports, not merely direct guard-check calls. Prior12 predicate-guard controls remain separately retained and are not counted as these full-import controls.', results, sourceFallbackFile: { path: outside, sha256: sha(readFileSync(outside)) }, finalOriginalInstalledAbsent: !existsSync(installed), finalMovedUnchanged: true });
console.log(JSON.stringify({ actualLoadControls: results.length, pass: results.length, originalInstalledAbsent: !existsSync(installed) }));
