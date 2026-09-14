import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecEncoderRoutingCases, codecEncoderRoutingServiceCases} from './codec-encoder-routing-cases.js';

it.each(codecEncoderRoutingCases)('$name', ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    detail = session.eval('str(failure)');
  }
  expect(result.status, JSON.stringify(detail)).toBe('ok');
});

it.each(codecEncoderRoutingServiceCases)('$name', ({source}) => {
  let reads = 0, output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    input: {readLine() {reads++; return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source)).toMatchObject({status: 'ok'});
  expect(reads).toBe(1);
  expect(output).toBe('encoded\nfinished\n');
});

it.each(codecEncoderRoutingServiceCases)('fatal cancellation during $name', ({source}) => {
  let reads = 0, output = '';
  const controller = new AbortController();
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return 'continue\n';}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(1);
  expect(output).toBe('');
  expect(session.exec("print('resumed')")).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(output).toBe('');
});
