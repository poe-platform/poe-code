/** Unchanged public programs replayed against CPython 3.14.7 / Unicode 16.0.0.
 * No injected modules, native buffer adapters or alternative codec entry point. */
export const coreCodecBufferCases = ["ascii", "latin_1", "utf_8"].flatMap(codec => [
  {
    name: `${codec} inherited buffer failure precedes errors validation`,
    source: `
from _codecs import ${codec}_decode as decode
events = []
failure = ValueError('export failed')
class Export(bytes):
    def __buffer__(self, flags):
        events.append((self, flags))
        raise failure
class Derived(Export):
    def __getattribute__(self, name):
        raise AssertionError('instance attribute lookup')
source = Derived(b'inherited bytes')
for errors in (None, 1, '\\0', '\\ud800'):
    events.clear()
    try:
        decode(source, errors)
    except ValueError as caught:
        assert caught is failure
        assert caught.args == ('export failed',)
    else:
        assert False, 'decoder ignored __buffer__'
    assert len(events) == 1
    assert events[0][0] is source and events[0][1] == 0
`
  },
  {
    name: `${codec} validates buffer hook result before errors`,
    source: `
from _codecs import ${codec}_decode as decode
events = []
result = None
class Export(bytes):
    def __buffer__(self, flags):
        events.append(flags)
        return result
for result in (None, b'other', 'other', 1):
    for errors in (None, 1, '\\0'):
        events.clear()
        try:
            decode(Export(b'inherited'), errors)
        except TypeError as caught:
            assert caught.args == ('__buffer__ returned non-memoryview object',)
        else:
            assert False, 'invalid buffer hook result accepted'
        assert events == [0]
`
  },
  {
    name: `${codec} uses and releases an overridden bytes export`,
    source: `
from _codecs import ${codec}_decode as decode
events = []
backing = bytearray(b'AB')
class Export(bytes):
    def __buffer__(self, flags):
        events.append(('acquire', flags))
        return memoryview(backing)
    def __release_buffer__(self, view):
        events.append(('release', view.obj is backing))
source = Export(b'wrong inherited bytes')
assert decode(source) == ('AB', 2)
assert events == [('acquire', 0), ('release', True)]
backing.append(67)
events.clear()
try:
    decode(source, 1)
except TypeError as caught:
    assert caught.args == ('${codec}_decode() argument 2 must be str or None, not int',)
else:
    assert False
assert events == [('acquire', 0), ('release', True)]
backing.append(68)
`
  },
  {
    name: `${codec} rejects a strided memoryview`,
    source: `
from _codecs import ${codec}_decode as decode
source = memoryview(b'ABCD')[::2]
try:
    decode(source)
except BufferError as caught:
    assert caught.args == ('memoryview: underlying buffer is not C-contiguous',)
else:
    assert False
source.release()
`
  }
]);
