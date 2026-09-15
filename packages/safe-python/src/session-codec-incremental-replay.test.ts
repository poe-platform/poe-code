import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecIncrementalReplayCases} from './codec-incremental-replay-cases.js';
import reference from './runtime/__snapshots__/codec-incremental-replay-3.14.7.json';

it.each(codecIncrementalReplayCases)('incremental replay: $name', ({name, source}) => {
  const oracle = reference.rows.find(row => row.name === name)!;
  expect(oracle.source).toBe(source);
  expect(oracle.oracle.status).toBe(0);
  expect(oracle.oracle.stderr).toBe('');
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 8000000, maxAllocatedBytes: 64000000, maxDepth: 100},
    hashSeed: [1n, 2n], input: {readLine() {return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    const message = session.eval('repr(failure)');
    if (message.status === 'ok') diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(oracle.oracle.stdout);
});

it('keeps cancellation terminal during incremental error callback state mutation', () => {
  const controller = new AbortController();
  let reads = 0, output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(codecIncrementalReplayCases.at(-1)!.source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(1);
  expect(output).toBe('');
  expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
