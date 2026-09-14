import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecDecoderReplacementStorageCases} from './codec-decoder-replacement-storage-cases.js';
import reference from './runtime/__snapshots__/codec-decoder-replacement-storage-3.14.7.json';

it.each(codecDecoderReplacementStorageCases)('retains decoder replacement Unicode storage: $name', ({name, source}) => {
  expect(reference.reference).toMatchObject({unicode: '16.0.0', platform: 'darwin', byteorder: 'little'});
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  const row = reference.rows.find(candidate => candidate.name === name)!;
  expect(row).toMatchObject({source, status: 0, stderr: ''});
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 150},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source).status, output).toBe('ok');
  expect(output).toBe(row.stdout);
});
