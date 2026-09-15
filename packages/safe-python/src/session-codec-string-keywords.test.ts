import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStringKeywordCases, codecStringKeywordCancellationCases} from './codec-string-keyword-cases.js';

it.each(codecStringKeywordCases)('$name', ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    detail = session.eval('str(failure)');
  }
  expect(result.status, JSON.stringify(detail)).toBe('ok');
});

it.each(codecStringKeywordCancellationCases)('fatal cancellation during $name diagnostics', ({source}) => {
  const controller = new AbortController(), output: string[] = [];
  const session = new PythonSession({
    limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    output: {write(text) {output.push(text); controller.abort();}, flush() {}},
  });
  expect(session.exec(source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(output).toEqual(['cancel']);
  expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
