import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamCoreServiceCases} from './codec-stream-core-service-cases.js';
import reference from './runtime/__snapshots__/codec-stream-core-services-3.14.7.json';

it.each(codecStreamCoreServiceCases)('$name', ({name, source, input}) => {
  let output = '';
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 4000000, maxAllocatedBytes: 64000000, maxDepth: 150},
    hashSeed: [1n, 2n],
    input: {readLine() { reads++; return reads === 1 ? input : null; }},
    output: {write(text) { output += text; }, flush() {}}
  });
  expect(session.exec(source)).toMatchObject({status: 'ok'});
  expect(output).toBe(reference.cases.find(row => row.name === name)!.output);
  expect(reads).toBe(1);
});
