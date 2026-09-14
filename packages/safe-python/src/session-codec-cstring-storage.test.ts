import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecCStringStorageCases} from './codec-cstring-storage-cases.js';
import reference from './runtime/__snapshots__/codec-cstring-storage-3.14.7.json' with {type: 'json'};

it.each(codecCStringStorageCases)('$name', ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected).toMatchObject({source, status: 0, stderr: ''});
  let output = '';
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe('ok');
  expect(output).toBe(expected.stdout);
});
