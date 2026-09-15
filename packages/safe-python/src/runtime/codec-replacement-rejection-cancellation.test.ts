import {expect, it} from 'vitest';
import {PythonRuntimeError} from './error.js';
import {ExecutionBudget, ExecutionLimitError} from './execution-budget.js';
import {RuntimeExceptionExecution} from './runtime-exception-execution.js';
import {RuntimeTypeRegistry} from './runtime-type-registry.js';
import {RuntimeValues, type RuntimeValue} from './runtime-values.js';
import {encodeSingleByte} from './single-byte-encode.js';
import {encodeUtf8, type Utf8EncodeRecovery} from './utf8-encode.js';
import {encodeWideUnicode} from './utf-wide.js';

const cases = ['ascii', 'latin-1', 'utf-8', 'utf-16-text', 'utf-16-bytes', 'utf-32-text', 'utf-32-bytes']
  .flatMap(encoding => (['ordinary', 'guest', 'fatal'] as const).flatMap(outcome =>
    [false, true].map(cancel => ({encoding, outcome, cancel}))));

it.each(cases)('$encoding replacement rejection: $outcome, cancelled=$cancel', ({encoding, outcome, cancel}) => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const values = new RuntimeValues(meter);
  const types = new RuntimeTypeRegistry(values, {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b}, meter);
  const exceptions = new RuntimeExceptionExecution(types, values, meter);
  const failures = {
    ordinary: new Error('replacement rejection failed'),
    guest: exceptions.prepare(new PythonRuntimeError('ValueError', 'guest rejection failed')),
    fatal: new ExecutionLimitError('allocation')
  };
  const failure = failures[outcome];
  const source = values.string('\ud800').value;
  const replacement = encoding.endsWith('bytes') ? Uint8Array.of(65) : values.string('\u0100').value;
  const events: string[] = [];
  const recover: Utf8EncodeRecovery = () => {
    events.push('recover');
    return {replacement, position: 1, rejectReplacement() {
      events.push('reject');
      if (cancel) controller.abort();
      throw failure;
    }};
  };
  const run = () => encoding === 'ascii' || encoding === 'latin-1'
    ? encodeSingleByte(source, encoding, recover, meter)
    : encoding === 'utf-8' ? encodeUtf8(source, recover, meter)
      : encodeWideUnicode(source, encoding.startsWith('utf-16') ? 16 : 32, 0, recover, meter);
  let caught: unknown;
  try {run();} catch (error) {caught = error;}
  expect(events).toEqual(['recover', 'reject']);
  if (outcome === 'fatal' || !cancel) expect(caught).toBe(failure);
  else expect(caught).toMatchObject({reason: 'cancelled'});
  if (cancel) {
    expect(run).toThrow(ExecutionLimitError);
    expect(events).toEqual(['recover', 'reject']);
  }
});
