import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecDecoderObjectTransferCases} from './codec-decoder-object-transfer-cases.js';
import reference from './runtime/__snapshots__/codec-decoder-object-transfer-3.14.7.json';

it.each(codecDecoderObjectTransferCases)('$name', ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(source).toBe(oracle.source);
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 4000000, maxAllocatedBytes: 64000000, maxDepth: 150},
    hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  expect(result.status, output).toBe('ok');
  expect(output).toBe(oracle.output);
});
