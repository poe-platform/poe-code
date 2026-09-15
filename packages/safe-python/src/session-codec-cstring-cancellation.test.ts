import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecCStringServiceCases} from './codec-cstring-service-cases.js';

it.each(codecCStringServiceCases)('C-string decode cancellation: $name', ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0;
    const session = new PythonSession({signal: controller.signal, hashSeed: [1n, 2n],
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      input: {readLine() {reads++; controller.abort(); if (throws) throw Error('service failed'); return 'custom';}},
      output: {write() {}, flush() {}}
    });
    expect(session.exec(source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
    expect(reads).toBe(1);
    expect(session.exec('pass')).toMatchObject({status: 'terminated', reason: 'cancelled'});
  }
});
