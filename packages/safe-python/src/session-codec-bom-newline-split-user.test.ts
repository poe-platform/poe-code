import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecBomNewlineSplitUserCases} from './codec-bom-newline-split-user-cases.js';
import reference from './runtime/__snapshots__/codec-bom-newline-split-user-3.14.7.json';

it.each(codecBomNewlineSplitUserCases)('actual BOM/newline state transfer: $name', ({name, source}) => {
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  expect(reference.reference).toMatchObject({unicode: '16.0.0', platform: 'darwin', byteorder: 'little'});
  const row = reference.rows.find(candidate => candidate.name === name)!;
  expect(row).toMatchObject({source, oracle: {status: 0, stderr: ''}});
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 4000000, maxAllocatedBytes: 64000000, maxDepth: 150},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  expect(result.status, output).toBe('ok');
  expect(output).toBe(row.oracle.stdout);
});
