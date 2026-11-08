import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { fmt, fmtCommand, createFmtEngine, defaultFmtLimits, parseFmtArguments } from './index.js';

interface Control {
  id: string;
  input: string;
  inputBase64?: string;
  args: string[];
  locale: string;
  stdout: string;
  stderr: string;
  status: number;
  portableStderr?: string;
}
// Static authenticated manual observations. Never invoke the oracle in tests.
const controls = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/released-9.10.json.gz', import.meta.url))).toString('utf8')) as Control[];
const encoder = new TextEncoder();

// Large-output margin/window transcripts live in the separate manual QA archive.
for (const control of controls.filter(control => control.status === 0)) test(`released 9.10 ${control.locale} ${control.id}`, () => {
  assert.equal(control.status, 0);
  assert.equal(control.stderr, '');
  const input = control.inputBase64 === undefined ? encoder.encode(control.input) : new Uint8Array(Buffer.from(control.inputBase64, 'base64'));
  const expected = new Uint8Array(Buffer.from(control.stdout, 'base64'));
  for (const chunkSize of [1, 37, 4096]) {
    const engine = createFmtEngine(parseFmtArguments(control.args.map(arg => encoder.encode(arg))), defaultFmtLimits, new AbortController().signal);
    const machine = engine.run();
    let position = 0;
    let offset = 0;
    let step = machine.next();
    while (!step.done) {
      if (step.value === 'input') {
        const chunk = offset === input.length ? null : input.subarray(offset, offset + chunkSize);
        offset += chunk?.length ?? 0;
        step = machine.next(chunk);
      } else {
        if (step.value) {
          assert.deepEqual(step.value, expected.subarray(position, position + step.value.length), `chunk size ${chunkSize}, output byte ${position}`);
          position += step.value.length;
        }
        step = machine.next();
      }
    }
    assert.equal(position, expected.length);
    assert.equal(engine.accounting().retainedBytes, 0);
    assert.ok(engine.accounting().peakRetainedBytes <= defaultFmtLimits.retainedBytes);
  }
});

for (const control of controls.filter(control => control.id.startsWith('original-') || control.id.startsWith('negative-'))) {
  test(`released CLI/SDK ${control.locale} ${control.id}`, async () => {
    for (const sdk of [false, true]) {
      const carrier = createCommandArguments(sdk ? [] : control.args);
      const output: Uint8Array[] = [], errors: Uint8Array[] = [];
      const cleanups: (() => Promise<void>)[] = [];
      let acquired = 0;
      const input = control.inputBase64 === undefined ? encoder.encode(control.input) : new Uint8Array(Buffer.from(control.inputBase64, 'base64'));
      const context = {
        command: 'fmt', args: carrier.args, argumentValues: carrier, cwd: '/',
        env: { LC_ALL: control.locale }, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {
          acquired++;
          for (let offset = 0; offset < input.length; offset += 3) yield input.slice(offset, offset + 3);
        } },
        stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); output.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } },
        registerCleanup(cleanup: () => Promise<void>) { cleanups.push(cleanup); },
        fs: new Proxy({}, { get() { throw new Error('stdin formatting requested file authority'); } }),
      } as unknown as CommandContext;
      const result = sdk ? await fmt(context, { arguments: control.args.map(arg => encoder.encode(arg)) })
        : await fmtCommand().execute(context);
      await Promise.all(cleanups.map(cleanup => cleanup()));
      assert.equal(result.exitCode, control.status);
      assert.deepEqual(Buffer.concat(output), Buffer.from(control.stdout, 'base64'));
      assert.deepEqual(Buffer.concat(errors), Buffer.from(control.portableStderr ?? control.stderr, 'base64'));
      if (control.status !== 0) assert.equal(acquired, 0, 'invalid invocation acquired stdin');
    }
  });
}
