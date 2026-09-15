import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamMutationCases} from './codec-stream-mutation-cases.js';
import reference from './runtime/__snapshots__/codec-stream-mutation-3.14.7.json';

it.each(codecStreamMutationCases)('$name', ({name, source}) => {
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 4000000, maxAllocatedBytes: 64000000, maxDepth: 150},
    hashSeed: [1n, 2n],
    output: {write(text) { output += text; }, flush() {}}
  });
  const result = session.exec(source);
  let diagnostic = result.status;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    const message = session.eval('str(failure)');
    if (message.status === 'ok') diagnostic += ': ' + String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(reference.cases.find(row => row.name === name)!.output);
});
