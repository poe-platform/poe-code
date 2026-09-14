import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecSearchMutationCases} from './codec-search-mutation-cases.js';

it.each(codecSearchMutationCases)('registry mutation: $name', ({source, output: expected}) => {
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], input: {readLine() {return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    const message = session.eval('repr(failure)');
    if (message.status === 'ok') diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(expected);
});

it('keeps cancellation terminal when a search callback tries to extend the path', () => {
  const controller = new AbortController();
  let reads = 0, output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(codecSearchMutationCases[4].source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(1);
  expect(output).toBe('');
  expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
