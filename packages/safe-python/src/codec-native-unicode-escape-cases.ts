/** Identical programs run in PythonSession and the external pinned oracle. */
export const nativeUnicodeEscapeCases = [
  {name: "metadata, identity, surrogate and non-BMP encoding", source: String.raw`
import _codecs
for name in ('unicode_escape', 'raw_unicode_escape'):
    encoder = getattr(_codecs, name + '_encode')
    decoder = getattr(_codecs, name + '_decode')
    assert encoder.__self__ is decoder.__self__ is _codecs
    assert encoder.__module__ == decoder.__module__ == '_codecs'
    assert encoder.__doc__ is decoder.__doc__ is None
    assert encoder.__text_signature__ == '($module, str, errors=None, /)'
    assert decoder.__text_signature__ == '($module, data, errors=None, final=True, /)'
    source = 'Aé\t\n\U0001f40d\ud800\udfff'
    encoded, consumed = encoder(source, 'unknown-handler')
    assert consumed == len(source)
    assert decoder(encoded) == (source, len(encoded))
    empty = b''
    character = 'a'
    assert encoder('')[0] is empty
    assert (encoder('a')[0] is encoder('a')[0]) is (name == 'raw_unicode_escape')
    assert decoder(b'a')[0] is character
    assert decoder('é') == ('Ã©', 2)
assert _codecs.unicode_escape_encode('é\ud800') == (br'\xe9\ud800', 2)
assert _codecs.unicode_escape_encode('\uac00') == (br'\uac00', 1)
`},
  ...["unicode_escape", "raw_unicode_escape"].map(name => ({name: `${name} every split and negative recovery`, source: String.raw`
import _codecs
decode = _codecs.${name}_decode
source = br'A\u20ac\U0001f40dZ'
for split in range(len(source) + 1):
    first, consumed = decode(source[:split], None, False)
    second, rest = decode(source[consumed:], None, True)
    assert first + second == 'A€🐍Z'
    assert consumed + rest == len(source)
assert decode(br'\u12', None, False) == ('', 0)
try:
    decode(br'\u12')
except UnicodeDecodeError as error:
    assert (error.start, error.end, error.reason) == (0, 4, 'truncated \\uXXXX escape')
else:
    assert False
events = []
class Position:
    def __index__(self):
        events.append('index')
        return -1
def handler(error):
    events.append(error)
    error.object = b'XYZ'
    return ('?', Position())
_codecs.register_error('escape_resume', handler)
assert decode(br'\uQ', 'escape_resume') == ('?Z', 3)
assert len(events) == 2 and events[1] == 'index'
assert events[0].object == b'XYZ'
assert events[0].__traceback__ is None
failure = ValueError('guest callback failed')
def fail(error):
    raise failure
_codecs.register_error('escape_failure', fail)
try:
    decode(br'\uQ', 'escape_failure')
except ValueError as error:
    assert error is failure
    assert not hasattr(error, '__notes__')
else:
    assert False
`})),
  ...["unicode_escape", "raw_unicode_escape"].map(name => ({name: `${name} binding and validation order`, source: String.raw`
import _codecs
encode = _codecs.${name}_encode
decode = _codecs.${name}_decode
events = []
class Final:
    def __bool__(self):
        events.append('final')
        return False
assert decode(br'\u12', None, Final()) == ('', 0)
assert events == ['final']
for invoke, message in (
    (lambda: encode(), '${name}_encode expected at least 1 argument, got 0'),
    (lambda: decode(), '${name}_decode expected at least 1 argument, got 0'),
    (lambda: encode('a', None, False), '${name}_encode expected at most 2 arguments, got 3'),
    (lambda: decode(b'a', None, False, False), '${name}_decode expected at most 3 arguments, got 4'),
    (lambda: encode(b'a'), '${name}_encode() argument 1 must be str, not bytes'),
    (lambda: decode(None, 1), "a bytes-like object is required, not 'NoneType'"),
    (lambda: decode(b'a', 1, Final()), '${name}_decode() argument 2 must be str or None, not int'),
    (lambda: encode(str='a'), '_codecs.${name}_encode() takes no keyword arguments'),
    (lambda: decode(data=b'a'), '_codecs.${name}_decode() takes no keyword arguments')
):
    try:
        invoke()
    except TypeError as error:
        assert error.args == (message,), error.args
    else:
        assert False
assert events == ['final']
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string conversion')
source = Text('\ud800')
# Text decoding crosses the UTF-8 boundary before validating the error argument.
try:
    decode(source, 1)
except UnicodeEncodeError as error:
    assert error.object is source
else:
    assert False
`}))
];

for (const name of ["unicode_escape", "raw_unicode_escape"]) nativeUnicodeEscapeCases.push({
  name: `${name} handler validation and operation-local caching`, source: String.raw`
import _codecs
decode = _codecs.${name}_decode
for returned, kind, message in (
    (None, TypeError, 'decoding error handler must return (str, int) tuple'),
    ((b'?', 0), TypeError, 'decoding error handler must return (str, int) tuple'),
    (('?', 1.5), TypeError, "'float' object cannot be interpreted as an integer"),
    (('?', 1 << 100), OverflowError, 'Python int too large to convert to C ssize_t'),
    (('?', -4), IndexError, 'position -1 from error handler out of bounds'),
    (('?', 4), IndexError, 'position 4 from error handler out of bounds')
):
    def handler(error):
        return returned
    _codecs.register_error('escape_validation', handler)
    try:
        decode(br'\uQ', 'escape_validation')
    except BaseException as error:
        assert type(error) is kind
        assert error.args == (message,)
    else:
        assert False
events = []
def second(error):
    events.append('second')
    return ('!', error.end)
def first(error):
    events.append(error)
    _codecs.register_error('escape_cached', second)
    return ('?', error.end)
_codecs.register_error('escape_cached', first)
assert decode(br'\uQ\uR', 'escape_cached') == ('?Q?R', 6)
assert events[0] is events[1]
assert decode(br'\uQ', 'escape_cached') == ('!Q', 3)
assert events[-1] == 'second'
for policy in ('strict', 'ignore', 'replace', 'backslashreplace', 'surrogatepass', 'surrogateescape'):
    original = _codecs.lookup_error(policy)
    _codecs.register_error(policy, second)
    try:
        assert decode(br'\uQ', policy) == ('!Q', 3)
    finally:
        _codecs.register_error(policy, original)
`});
