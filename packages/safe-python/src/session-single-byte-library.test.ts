import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecMappingHelperSource, singleByteLibraryCases} from './single-byte-library-cases.js';

it.each([{name: 'mapping helpers', source: codecMappingHelperSource}, ...singleByteLibraryCases])('single-byte library: $name', ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 4000000, maxAllocatedBytes: 32000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    detail = session.eval('str(failure)');
  }
  expect(result.status, JSON.stringify(detail)).toBe('ok');
});

it.each(['mapping', 'handler', 'writer'])('keeps cancellation fatal through single-byte %s callbacks', operation => {
  const controller = new AbortController();
  let calls = 0;
  const session = new PythonSession({
    limits: {maxSteps: 4000000, maxAllocatedBytes: 32000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { calls++; controller.abort(); return 'cancelled\n'; }}, output: {write() {}, flush() {}}
  });
  const result = session.exec(`
import codecs
import encodings.cp437 as module
def cancel(*args):
    input()
    raise ValueError('after cancellation')
class Mapping:
    def __getitem__(self, key):
        return cancel()
class Stream:
    def write(self, data):
        return cancel()
codecs.register_error('cancel', cancel)
try:
    ${operation === 'mapping' ? "module.encoding_map = Mapping()\n    codecs.encode('A', 'cp437')" : operation === 'handler' ? "codecs.encode('\\ud800', 'cp437', 'cancel')" : "codecs.getwriter('cp437')(Stream()).write('A')"}
except BaseException:
    raise AssertionError('cancellation reached guest')
`);
  expect(calls).toBe(1);
  expect(result).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(session.exec('assert False')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});

it('keeps module mapping mutation local to its interpreter and live for cached codecs', () => {
  const sessions = [0, 1].map(() => new PythonSession({limits: {maxSteps: 4000000, maxAllocatedBytes: 32000000, maxDepth: 100}, hashSeed: [1n, 2n]}));
  for (const session of sessions) {
    expect(session.exec(`
import codecs
import encodings.cp437 as module
info = codecs.lookup('cp437')
assert info.encode('A') == (b'A', 1)
`).status).toBe('ok');
  }
  expect(sessions[0].exec(`
module.encoding_map[65] = 66
assert info.encode('A') == (b'B', 1)
assert codecs.encode('A', 'cp437') == b'B'
assert info.incrementalencoder().encode('A', True) == b'B'
`).status).toBe('ok');
  expect(sessions[1].exec(`
assert info.encode('A') == (b'A', 1)
assert codecs.encode('A', 'cp437') == b'A'
assert info.incrementalencoder().encode('A', True) == b'A'
`).status).toBe('ok');
});
