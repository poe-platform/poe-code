# Original-workload profile command

Three diagnostic samples each, not wall-clock unit tests.

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { loadavg } from 'node:os';
import { run } from './packages/safe-js/src/run.ts';
import { Budget } from './packages/safe-js/src/interp/budget.ts';
import { serializeSafeJSSnapshot } from './packages/safe-js/src/snapshot/dump-format.ts';
import { runSnapshotMutationCorpus } from './packages/safe-js/test/adversarial/snapshot-mutation.ts';
const directory = 'docs/plans/qualify-resource-and-timing-behavior/descriptor-review-20260914';
const camera = JSON.parse(readFileSync('packages/safe-js/src/interp/fixtures/float32-camera.json', 'utf8'));
const nativeCamera = Function(`${camera.source.slice('export default '.length)}\nreturn cameraWorkflow;`)();
const records = [];
const workloads = [
  ['historical-replay-128', async () => {
    const width = 128;
    let reads = 0;
    const read = async index => { reads++; return index + 10; };
    const source = `const values = []; for (let index = 0; index < ${width}; index++) { payload.count++; values.push([payload.count, Math.random(), await read(index)]); } return values;`;
    const original = await run(source, { bindings: { read, payload: { count: 3 } } });
    assert.equal(original.ok, true);
    assert.equal(original.returnValue.length, width);
    let snapshot = JSON.parse(serializeSafeJSSnapshot(original.snapshot));
    for (let iteration = 0; iteration < 3; iteration++) {
      const resumed = await run(source, { snapshot, bindings: { read } });
      assert.equal(resumed.ok, true);
      assert.deepEqual(resumed.returnValue, original.returnValue);
      assert.equal(reads, width);
      snapshot = JSON.parse(serializeSafeJSSnapshot(resumed.snapshot));
    }
  }],
  ['snapshot-current-96', runSnapshotMutationCorpus],
  ...camera.cases.map(entry => [`historical-camera-${entry.caseId}`, async () => {
    const result = await run(camera.source, {
      entryPointArgs: [entry.fixture], randomSeed: 827,
      budget: new Budget({ maxSteps: 600000, maxCallDepth: 128,
        stringLength: 65536, arrayLength: 8192, dataSize: 8000000 })
    });
    assert.equal(result.ok, true);
    assert.deepEqual(structuredClone(result.returnValue), structuredClone(nativeCamera(entry.fixture)));
    assert.deepEqual(JSON.parse(JSON.stringify(result.returnValue)), entry.expected);
    assert.deepEqual(JSON.parse(JSON.stringify(nativeCamera(entry.fixture))), entry.expected);
  }]),
  ['split-reported', async () => {
    const source = "const regex = new RegExp('(b)?', 'm'); regex.lastIndex = 2; return { result: 'ac'.split(regex, undefined), lastIndex: regex.lastIndex };";
    const result = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5000 }) });
    assert.equal(result.ok, true);
    // ECMA-262 edition 16, 22.2.6.14: unmatched capture is an own undefined slot.
    assert.deepEqual([...result.returnValue.result], ['a', undefined, 'c']);
    assert.equal(Object.hasOwn(result.returnValue.result, 1), true);
    assert.equal(result.returnValue.lastIndex, 2);
  }]
];
for (const [name, execute] of workloads) {
  const session = new Session(); session.connect();
  await session.post('Profiler.enable'); await session.post('Profiler.start');
  for (let sample = 1; sample <= 3; sample++) {
    const cpu = process.cpuUsage(); const start = performance.now(); const load = loadavg();
    let error;
    try { await execute(); } catch (failure) { error = String(failure?.stack ?? failure); }
    const elapsed = performance.now() - start; const used = process.cpuUsage(cpu);
    records.push({ name, sample, elapsed, cpuMs: (used.user + used.system) / 1000,
      load, error, within5000: elapsed <= 5000 });
    writeFileSync(`${directory}/original-measurements.json`, JSON.stringify({
      versions: process.versions, platform: process.platform, arch: process.arch,
      profiling: true, records }, null, 2) + '\n');
    console.log(name, sample, elapsed.toFixed(2), error ? 'FAILED' : 'assertions passed');
  }
  const { profile } = await session.post('Profiler.stop');
  writeFileSync(`${directory}/${name.replaceAll(":", "-")}.cpuprofile`, JSON.stringify(profile));
  session.disconnect();
}
JS
```
