import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamReaderReentryUserCases} from './codec-stream-reader-reentry-user-cases.js';
import reference from './runtime/__snapshots__/codec-stream-reader-reentry-user-3.14.7.json';

it.each(codecStreamReaderReentryUserCases)('stream reader reentry: $name', ({name, source}) => {
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  expect(reference.reference.unicode).toBe('16.0.0');
  expect(reference.reference.platform).toBe('darwin');
  expect(reference.reference.byteorder).toBe('little');
  const row = reference.cases.find(candidate => candidate.name === name)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe('');
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 150},
    hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  expect(result.status, output).toBe('ok');
  expect(output).toBe(row.stdout);
});
