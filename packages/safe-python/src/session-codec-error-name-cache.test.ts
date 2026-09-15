import {expect, it} from "vitest";
import {PythonSession} from "./index.js";

export const errorNameCacheSource = String.raw`
import codecs, _codecs
original = codecs.lookup_error('strict')
seen = []
name = ''.join(['custom', '\ud800'])
def strict(error):
    assert error.object is name
    seen.append('encode')
    return (b'_recovered', error.end)
codecs.register_error('strict', strict)
handler = lambda error: ('?', error.end)
codecs.register_error(name, handler)
codecs.register_error('strict', original)
assert codecs.lookup_error(name) is handler
assert codecs.encode('\ud800', 'utf8', name) == b'?'
assert codecs.decode(b'\xff', 'utf8', name) == '?'
assert _codecs._unregister_error(name) is True
assert _codecs._unregister_error(name) is False
assert seen == ['encode']
`;

it('shares recovered error-name bytes across registry consumers', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(errorNameCacheSource).status).toBe('ok');
});

it('decodes malformed recovered names through strict only after callable validation', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(String.raw`
import codecs
seen = []
name = '\ud800'
def strict(error):
    seen.append(type(error).__name__)
    if isinstance(error, UnicodeEncodeError):
        return (b'\xff', error.end)
    return ('\ud801', error.end)
codecs.register_error('strict', strict)
try:
    codecs.register_error(name, None)
except TypeError as error:
    assert str(error) == 'handler must be callable'
else:
    assert False
assert seen == ['UnicodeEncodeError']
handler = lambda error: ('?', error.end)
codecs.register_error(name, handler)
assert codecs.lookup_error(name) is handler
assert seen == ['UnicodeEncodeError', 'UnicodeDecodeError', 'UnicodeDecodeError']
`).status).toBe('ok');
});

it('native kernels retain raw names and defer decoding until recovery', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(String.raw`
import codecs
seen = []
name = '\ud800'
def strict(error):
    seen.append(type(error).__name__)
    if isinstance(error, UnicodeEncodeError):
        return (b'\xff', error.end)
    return ('custom', error.end)
codecs.register_error('strict', strict)
codecs.register_error('custom', lambda error: ('?', error.end))
assert codecs.utf_8_encode('x', name) == (b'x', 1)
assert codecs.utf_16_le_encode('x', name) == (b'x\x00', 1)
assert seen == ['UnicodeEncodeError']
for operation in [lambda: codecs.ascii_encode('\u0100', name), lambda: codecs.utf_16_le_encode('\ud801', name)]:
    try:
        operation()
    except LookupError as error:
        assert str(error) == "unknown error handler name '\ufffd'"
    else:
        assert False
assert seen == ['UnicodeEncodeError', 'UnicodeDecodeError', 'UnicodeDecodeError']
`).status).toBe('ok');
});

it('shares native method and constructor error and encoding names', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(String.raw`
import codecs
original = codecs.lookup_error('strict')
name = 'utf\ud800'
errors = 'ign\ud801'
seen = []
def strict(error):
    seen.append(error.object)
    return (b'8' if error.object is name else b'ore', error.end)
codecs.register_error('strict', strict)
assert codecs.lookup(name).name == 'utf-8'
assert '\ud800'.encode(name, errors) == b''
codecs.register_error('strict', original)
assert b'\xff'.decode(name, errors) == ''
assert bytes('\ud800', name, errors) == b''
assert str(b'\xff', name, errors) == ''
assert seen == [name, errors]
`).status).toBe('ok');
});

it('renders misses from raw bytes independently of strict diagnostic recovery', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(String.raw`
import codecs
name = '\ud800'
def strict(error):
    return (b'\xff', error.end) if isinstance(error, UnicodeEncodeError) else ('missing', error.end)
codecs.register_error('strict', strict)
try:
    codecs.lookup_error(name)
except LookupError as error:
    assert str(error) == "unknown error handler name '\ufffd'"
else:
    assert False
`).status).toBe('ok');
});

it('shares length-bearing text caches with raw and escape consumers', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(String.raw`
import codecs
original = codecs.lookup_error('strict')
name = '\ud800'
seen = []
def strict(error):
    seen.append(error.object is name)
    return (b'abc\x00def', error.end)
codecs.register_error('strict', strict)
assert codecs.readbuffer_encode(name) == (b'abc\x00def', 7)
codecs.register_error('strict', original)
assert codecs.escape_decode(name) == (b'abc\x00def', 7)
assert codecs.unicode_escape_decode(name) == ('abc\x00def', 7)
assert codecs.raw_unicode_escape_decode(name) == ('abc\x00def', 7)
try:
    codecs.readbuffer_encode(b'x', name)
except ValueError as error:
    assert str(error) == 'embedded null character'
else:
    assert False
assert seen == [True]
`).status).toBe('ok');
});

it.each([false, true])('error-name input cancellation stays terminal (throws=%s)', throws => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({signal: controller.signal, hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, input: {
    readLine() {reads++; controller.abort(); if (throws) throw Error('cancelled service'); return 'custom';}
  }, output: {write() {}, flush() {}}});
  expect(session.exec(String.raw`
import codecs
codecs.register_error('strict', lambda error: (input(), error.end))
codecs.register_error('\ud800', lambda error: ('?', error.end))
`)).toMatchObject({status: 'terminated', reason: 'cancelled'});
  expect(reads).toBe(1);
  expect(session.exec('pass')).toMatchObject({status: 'terminated', reason: 'cancelled'});
});

it('retries failed subtype conversions and keeps successful caches after invalidation', () => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}});
  expect(session.exec(String.raw`
import codecs, _codecs
class Name(str):
    def __str__(self):
        raise AssertionError('str hook')
    def encode(self, *args):
        raise AssertionError('encode hook')
name = Name('custom\ud800')
other = Name('custom\ud800')
seen = []
sentinel = ValueError('retry')
def fail(error):
    assert error.object is name
    seen.append('fail')
    raise sentinel
codecs.register_error('strict', fail)
for attempt in range(2):
    try:
        codecs.lookup_error(name)
    except ValueError as error:
        assert error is sentinel
    else:
        assert False
def strict(error):
    seen.append(error.object is name)
    return (b'_name' if error.object is name else b'_other', error.end)
codecs.register_error('strict', strict)
handler = lambda error: ('?', error.end)
codecs.register_error(name, handler)
codecs.register_error(other, handler)
search = lambda name: None
codecs.register(search)
codecs.unregister(search)
assert codecs.lookup_error(name) is handler
assert codecs.lookup_error(other) is handler
assert _codecs._unregister_error(name)
assert codecs.lookup_error(other) is handler
assert seen == ['fail', 'fail', True, False]
`).status).toBe('ok');
});
