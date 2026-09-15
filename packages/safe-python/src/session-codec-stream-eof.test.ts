import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamEofCases} from './codec-stream-eof-cases.js';
import reference from './runtime/__snapshots__/codec-stream-eof-3.14.7.json';

it.each(codecStreamEofCases)('$name', ({name, source, input}) => {
  const lines = input.split('\n').slice(0, -1);
  let reads = 0, output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    input: {readLine() { return reads < lines.length ? lines[reads++] + '\n' : null; }},
    output: {write(text) { output += text; }, flush() {}}
  });
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === 'exception') {
    session.globals.set('failure_detail', result.exception);
    const message = session.eval('str(failure_detail)');
    if (message.status === 'ok') diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(reference.cases.find(row => row.name === name)!.output);
  expect(reads).toBe(lines.length);
});
