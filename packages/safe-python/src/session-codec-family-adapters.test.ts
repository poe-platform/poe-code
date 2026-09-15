import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecAdapterFamilies, codecFamilyAdapterCases} from './codec-family-adapter-cases.js';
import {codecSignatureEdgeCases} from './codec-signature-edge-cases.js';
import reference from './runtime/__snapshots__/codec-family-adapters-3.14.7.json';

it.each([...codecFamilyAdapterCases, ...codecSignatureEdgeCases])('$name', ({name, source}) => {
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 4000000, maxAllocatedBytes: 64000000, maxDepth: 150}, hashSeed: [1n, 2n],
    output: {write(text) { output += text; }, flush() {}}
  });
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    detail = session.eval('str(failure)');
  }
  expect(result.status, JSON.stringify(detail)).toBe('ok');
  expect(output).toBe(reference.cases.find(row => row.name === name)!.output);
});

it.each(codecAdapterFamilies)('%s stream cancellation stays fatal', encoding => {
  const controller = new AbortController();
  const writes: string[] = [];
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    signal: controller.signal,
    output: {write(text) { writes.push(text); controller.abort(); }, flush() {}}
  });
  const result = session.exec(`
import codecs
class Stream:
    def write(self, data):
        print('cancel')
        raise ValueError('after cancellation')
try:
    codecs.getwriter('${encoding}')(Stream()).write('A')
except BaseException:
    print('recovered')
`);
  expect(writes).toEqual(['cancel']);
  expect(result).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});
