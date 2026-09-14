import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecEncodedFileKeywordCases, codecEncodedFileKeywordServiceSource} from './codec-encoded-file-keyword-cases.js';

it.each(codecEncodedFileKeywordCases)('$name', ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    detail = session.eval('str(failure)');
  }
  expect(result.status, JSON.stringify(detail)).toBe('ok');
});

it('cancels during keyword equality input without entering the factory', () => {
  const controller = new AbortController();
  let reads = 0;
  let output = '';
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return 'file\n'; }},
    output: {write(text) { output += text; }, flush() {}}});
  expect(session.exec(codecEncodedFileKeywordServiceSource)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(1);
  expect(output).toBe('');
  expect(session.exec('print("resumed")')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
