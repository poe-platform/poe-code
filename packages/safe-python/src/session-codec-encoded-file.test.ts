import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecEncodedFileCases, codecEncodedFileServiceSource} from './codec-encoded-file-cases.js';

const options = {limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n] as const};

it.each(codecEncodedFileCases)('$name', ({source}) => {
  const session = new PythonSession(options);
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    detail = session.eval('str(failure)');
  }
  expect(result.status, JSON.stringify(detail)).toBe('ok');
});

it.each([false, true])('EncodedFile registry callback I/O (cancel=%s)', cancel => {
  let reads = 0, output = '';
  const controller = new AbortController();
  const session = new PythonSession({...options, signal: controller.signal,
    input: {readLine() {reads++; if (cancel) controller.abort(); return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(codecEncodedFileServiceSource);
  expect(reads).toBe(1);
  expect(result).toMatchObject(cancel ? {status: 'terminated', reason: 'cancelled'} : {status: 'ok'});
  expect(output).toBe(cancel ? '' : 'encoded\nfinished\n');
  if (cancel) expect(session.exec("print('resumed')")).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
