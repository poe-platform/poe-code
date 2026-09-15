import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecRot13CancellationCases, codecRot13UndefinedCases} from './codec-rot13-undefined-cases.js';
import reference from './runtime/__snapshots__/codec-rot13-undefined-3.14.7.json';

it.each(codecRot13UndefinedCases)('$name', ({name, source}) => {
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
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

it.each(codecRot13CancellationCases)('fatal cancellation: $name', ({source}) => {
  const controller = new AbortController();
  let reads = 0, output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return 'cancelled\n'; }},
    output: {write(text) { output += text; }, flush() {}}
  });
  expect(session.exec(source)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(1);
  expect(output).toBe('');
  expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});

it('isolates mutable module maps between interpreters', () => {
  const options = {limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n] as const};
  const first = new PythonSession(options), second = new PythonSession(options);
  expect(first.exec("import encodings.rot_13 as rot\nrot.rot13_map[65] = 90").status).toBe('ok');
  expect(second.exec("import codecs\nassert codecs.encode('A', 'rot13') == 'N'").status).toBe('ok');
  expect(first.exec("import codecs\nassert codecs.encode('A', 'rot13') == 'Z'").status).toBe('ok');
});
