import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function containedJob(moduleUrl, payload, options = {}) {
  const deadlineMs = options.deadlineMs ?? 2000;
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 2000);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { moduleUrl, payload },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    stdout: true,
    stderr: true,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });
  const chunks = [];
  let bytes = 0, settled = false, heartbeats = 0;
  const heartbeat = setInterval(() => { heartbeats += 1; }, 10);
  let result;
  try {
    result = await new Promise(resolveResult => {
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolveResult(value);
      };
      const deadline = setTimeout(() => finish({ state: 'outer-timeout', passed: false }), deadlineMs);
      for (const [name, stream] of [['stdout', worker.stdout], ['stderr', worker.stderr]]) stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8192) finish({ state: 'outer-output-cap', passed: false });
        else chunks.push({ stream: name, base64: Buffer.from(chunk).toString('base64') });
      });
      worker.on('message', value => finish({ state: 'returned', value }));
      worker.on('error', error => finish({ state: 'outer-error', passed: false, error: { name: error.name, message: error.message } }));
      worker.on('exit', code => finish({ state: 'exit-without-result', passed: false, code }));
    });
  } finally {
    clearInterval(heartbeat);
    const terminationCode = await worker.terminate();
    if (result) Object.assign(result, { terminationAwaited: true, terminationCode, output: chunks, outputBytes: bytes, heartbeats, deadlineMs, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
  }
  return result;
}
if (!isMainThread && workerData && Object.hasOwn(workerData, 'moduleUrl')) {
  try {
    if (workerData.moduleUrl === 'selfcheck-spin') {
      while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (workerData.moduleUrl === 'selfcheck-good') parentPort.postMessage({ state: 'fulfilled', value: workerData.payload });
    else if (workerData.moduleUrl === 'selfcheck-undefined') throw undefined;
    else {
      const driver = await import(workerData.moduleUrl);
      const value = await driver.run(workerData.payload);
      parentPort.postMessage({ state: 'fulfilled', value });
    }
  } catch (reason) {
    parentPort.postMessage({ state: 'rejected', reasonType: typeof reason, reason: reason instanceof Error ? { name: reason.name, message: reason.message } : reason });
  }
}
if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const good = await containedJob('selfcheck-good', { marker: 7 });
  assert.equal(good.state, 'returned');
  assert.deepEqual(good.value, { state: 'fulfilled', value: { marker: 7 } });
  const undefinedRejection = await containedJob('selfcheck-undefined', null);
  assert.equal(undefinedRejection.value.state, 'rejected');
  assert.equal(undefinedRejection.value.reasonType, 'undefined');
  const spin = await containedJob('selfcheck-spin', null, { deadlineMs: 100 });
  assert.equal(spin.state, 'outer-timeout');
  assert.equal(spin.passed, false);
  assert(spin.heartbeats > 0);
  assert(spin.terminationAwaited);
  console.log(JSON.stringify({ harnessOnly: true, candidateExecuted: false, good, undefinedRejection, spin }, null, 2));
}
