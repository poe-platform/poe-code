import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecCStringSearchCases} from './codec-cstring-search-cases.js';
import reference from './runtime/__snapshots__/codec-cstring-search-3.14.7.json' with {type: 'json'};

it.each(codecCStringSearchCases)('$name', ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected).toMatchObject({source, status: 0, stderr: ''});
  let output = '', reads = 0;
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {reads++; return 'ready\n';}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe('ok');
  expect(output).toBe(expected.stdout);
  expect(reads).toBe(2);
});

it.each([1, 2].flatMap(readAt => [false, true].map(throws => ({readAt, throws}))))('cancels recovery at read $readAt (throws=$throws)', ({readAt, throws}) => {
  const controller = new AbortController();
  let reads = 0, writes = 0;
  const session = new PythonSession({signal: controller.signal, hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {
      reads++;
      if (reads === readAt) {
        controller.abort();
        if (throws) throw new Error('cancelled input');
      }
      return 'ready\n';
    }},
    output: {write() {writes++;}, flush() {}}
  });
  expect(session.exec(codecCStringSearchCases[0].source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(session.exec('assert False')).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(readAt);
  expect(writes).toBe(0);
});
