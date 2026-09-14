const encoders = [
  "_codecs.ascii_encode('\\ud800', 'chaining')",
  "_codecs.latin_1_encode('\\ud800', 'chaining')",
  "_codecs.utf_8_encode('\\ud800', 'chaining')",
  "_codecs.utf_16_le_encode('\\ud800', 'chaining')",
  "_codecs.utf_16_be_encode('\\ud800', 'chaining')",
  "_codecs.utf_32_le_encode('\\ud800', 'chaining')",
  "_codecs.utf_32_be_encode('\\ud800', 'chaining')",
  "_codecs.charmap_encode('\\ud800', 'chaining', {63: 63})"
];
const decoders = [
  "_codecs.ascii_decode(b'\\xff', 'chaining')",
  "_codecs.utf_8_decode(b'\\xff', 'chaining', True)",
  "_codecs.utf_16_le_decode(b'\\xff', 'chaining', True)",
  "_codecs.utf_16_be_decode(b'\\xff', 'chaining', True)",
  "_codecs.utf_32_le_decode(b'\\xff', 'chaining', True)",
  "_codecs.utf_32_be_decode(b'\\xff', 'chaining', True)",
  "_codecs.charmap_decode(b'\\xff', 'chaining', {})"
];

/** Unchanged guest programs also executed by the pinned external oracle. */
export const codecRecoveryChainingCases = [
  ...[...encoders, ...decoders].map(call => ({
    name: `unraised callback exception: ${call}`,
    source: String.raw`
import _codecs
outer = ValueError('outer')
seen = []
def handler(error):
    seen.append(error)
    assert error.__context__ is None, 'callback error was already chained'
    assert error.__cause__ is None
    assert error.__suppress_context__ is False
    assert error.__traceback__ is None
    return ('?', error.end)
_codecs.register_error('chaining', handler)
try:
    raise outer
except ValueError:
    ${call}
assert len(seen) == 1
assert seen[0].__context__ is None
assert seen[0].__traceback__ is None
`
  })),
  ...encoders.flatMap(call => [false, true].map(cycle => ({
    name: `rejected replacement ${cycle ? 'context cycle' : 'context mutation'}: ${call}`,
    source: String.raw`
import _codecs
outer = ValueError('outer')
replacement = ValueError('replacement')
cause = ValueError('cause')
seen = []
def handler(error):
    seen.append(error)
    error.__context__ = replacement
    error.__cause__ = cause
    ${cycle ? 'outer.__context__ = error' : 'pass'}
    return ('\ud800', error.end)
_codecs.register_error('chaining', handler)
try:
    raise outer
except ValueError:
    try:
        ${call}
    except UnicodeEncodeError as error:
        assert error is seen[0]
        assert error.__context__ is outer, 'rejection did not perform a new raise'
        assert error.__cause__ is cause
        assert error.__suppress_context__ is True
        assert outer.__context__ is None
    else:
        raise AssertionError('replacement accepted')
`
  }))),
  {
    name: "recursive callbacks retain independent unraised exception contexts",
    source: String.raw`
import _codecs
outer = ValueError('outer')
marker = ValueError('marker')
seen = []
def handler(error):
    seen.append(error)
    if error.object == '\ud802':
        assert error.__context__ is None
        return ('!', error.end)
    if error.start == 0:
        assert error.__context__ is None
        error.__context__ = marker
        assert _codecs.ascii_encode('\ud802', 'chaining') == (b'!', 1)
    else:
        assert error.__context__ is marker
    return ('?', error.end)
_codecs.register_error('chaining', handler)
try:
    raise outer
except ValueError:
    assert _codecs.ascii_encode('\ud800A\ud801', 'chaining') == (b'?A?', 3)
assert len(seen) == 3
assert seen[0] is seen[2]
assert seen[0] is not seen[1]
assert seen[0].__context__ is marker
assert seen[1].__context__ is None
`
  },
  {
    name: "generator callback rejection chains the TypeError without starting the generator",
    source: String.raw`
import _codecs
outer = ValueError('outer')
seen = []
def suspended(error):
    seen.append('started')
    yield ('?', error.end)
def handler(error):
    seen.append(error)
    return suspended(error)
_codecs.register_error('chaining', handler)
try:
    raise outer
except ValueError:
    try:
        _codecs.ascii_decode(b'\xff', 'chaining')
    except TypeError as error:
        assert error.args == ('decoding error handler must return (str, int) tuple',)
        assert error.__context__ is outer
    else:
        raise AssertionError('generator accepted')
assert len(seen) == 1
assert seen[0].__context__ is None
assert seen[0].__traceback__ is None
`
  }
];
