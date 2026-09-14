import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamOutputCancellationCases} from './codec-stream-output-cancellation-cases.js';

it.each(codecStreamOutputCancellationCases)('cancels $name at output without resuming guest code', ({source}) => {
  const controller = new AbortController();
  const writes: string[] = [];
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    signal: controller.signal,
    output: {write(text) { writes.push(text); controller.abort(); }, flush() {}}
  });
  expect(session.exec(source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(writes).toEqual(['c3a9' + (source.includes('writelines') ? 'f09f908d' : '')]);
  expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
