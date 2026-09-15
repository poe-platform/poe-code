import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecCStringReplacementCases, codecCStringReentryCases} from './codec-cstring-replacement-cases.js';
import reference from './runtime/__snapshots__/codec-cstring-replacement-3.14.7.json' with {type: 'json'};

it.each([...codecCStringReplacementCases, ...codecCStringReentryCases])('$name', ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected).toMatchObject({source, status: 0, stderr: ''});
  let output = '';
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return 'ready\n';}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe('ok');
  expect(output).toBe(expected.stdout);
});

it.each([1, 2, 3].flatMap(readAt => [false, true].map(throws => ({readAt, throws}))))('recovered replacement cancellation at read $readAt (throws=$throws)', ({readAt, throws}) => {
  let reads = 0;
  const controller = new AbortController();
  const session = new PythonSession({signal: controller.signal, hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {
      reads++;
      if (reads === readAt) {
        controller.abort();
        if (throws) throw new Error('cancelled input');
      }
      return 'ready\n';
    }}, output: {write() {}, flush() {}}
  });
  expect(session.exec(codecCStringReplacementCases[2].source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(session.exec('assert False')).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(readAt);
});
