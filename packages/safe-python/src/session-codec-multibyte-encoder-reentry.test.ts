import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecMultibyteEncoderReentryCases} from './codec-multibyte-encoder-reentry-cases.js';
import reference from './runtime/__snapshots__/codec-multibyte-encoder-reentry-3.14.7.json';

it.each(codecMultibyteEncoderReentryCases)('$name preserves callback and restored pending state', ({name, source}) => {
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  expect(reference.reference).toMatchObject({unicode: '16.0.0', platform: 'darwin', byteorder: 'little'});
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle).toMatchObject({source, status: 0, stderr: ''});
  let output = '';
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let diagnostic = output;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    const detail = session.eval('repr(failure)');
    if (detail.status === 'ok') diagnostic += String(detail.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(oracle.stdout);
});
