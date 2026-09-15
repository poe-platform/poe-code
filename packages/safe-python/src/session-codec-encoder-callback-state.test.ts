import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecEncoderCallbackStateCases} from './codec-encoder-callback-state-cases.js';
import reference from './runtime/__snapshots__/codec-encoder-callback-state-3.14.7.json';

it.each(codecEncoderCallbackStateCases)('$name', ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(source).toBe(oracle.source);
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let diagnostic = output;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    const detail = session.eval('str(failure)');
    if (detail.status === 'ok') diagnostic += String(detail.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(oracle.output);
});
