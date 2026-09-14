import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import reference from './runtime/__snapshots__/codec-rot13-undefined-blockers.json';

// Required compatibility gates. The recorded actual output is evidence only;
// it is never an accepted expectation for the pinned guest contract.
it.each(reference.cases)('$name', ({source, expected}) => {
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    output: {write(text) { output += text; }, flush() {}}
  });
  expect(session.exec(source).status).toBe('ok');
  expect(output).toBe(expected);
});
