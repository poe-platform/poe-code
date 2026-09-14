import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecDecoderReplacementStorageServiceCases} from './codec-decoder-replacement-storage-cases.js';
import reference from './runtime/__snapshots__/codec-decoder-replacement-storage-services-3.14.7.json';

it.each(codecDecoderReplacementStorageServiceCases)('replacement storage across callback services: $name', ({name, source}) => {
  const row = reference.rows.find(candidate => candidate.name === name)!;
  expect(row).toMatchObject({source, status: 0, stderr: ''});
  let output = '', reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 150}, hashSeed: [1n, 2n],
    input: {readLine() {reads++; return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source).status).toBe('ok');
  expect(reads).toBe(1);
  expect(output).toBe(row.stdout);
});

it.each(codecDecoderReplacementStorageServiceCases)('replacement storage cancellation is terminal: $name', ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let output = '', reads = 0;
    const session = new PythonSession({
      limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 150}, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {reads++; controller.abort(); if (throws) throw Error('service failed'); return 'continue\n';}},
      output: {write(text) {output += text;}, flush() {}},
    });
    expect(session.exec(source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
    expect(reads).toBe(1);
    expect(output).toBe('');
    expect(session.exec('pass')).toMatchObject({status: 'terminated', reason: 'cancelled'});
  }
});
