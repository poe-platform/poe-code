/** Sources run unchanged by the public interpreter and the external reference.
 * No injected modules, registry callbacks, builtin replacements or services. */
export const codecPublicContractCases = [
  {
    name: "byte escape types, argument precedence, warnings and buffer exports",
    source: String.raw`from _codecs import escape_encode, escape_decode
import warnings

class Buffer(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes')
    def __len__(self):
        raise AssertionError('virtual length')
class Text(str):
    def __str__(self):
        raise AssertionError('virtual text')
source = Buffer(b"A\n\xff'")
encoded = escape_encode(source, Text('unknown'))
assert encoded == (b"A\\n\\xff\\'", 4)
assert type(encoded) is tuple and type(encoded[0]) is bytes
assert escape_decode(encoded[0]) == (source, len(encoded[0]))
assert escape_decode(Text('é🐍')) == (b'\xc3\xa9\xf0\x9f\x90\x8d', 6)
single = b'A'
assert escape_encode(single)[0] is not single
assert escape_decode(single)[0] is single
empty = b''
assert escape_encode(empty)[0] is empty
assert escape_decode(empty)[0] is empty
for function in (escape_encode, escape_decode):
    assert function.__module__ == '_codecs'
    assert function.__doc__ is None
    assert function.__text_signature__ == '($module, data, errors=None, /)'
    try:
        function(data=b'')
    except TypeError as error:
        assert error.args == ('_codecs.' + function.__name__ + '() takes no keyword arguments',)
    else:
        assert False
    try:
        function(b'', 'strict\0')
    except ValueError as error:
        assert error.args == ('embedded null character',)
    else:
        assert False
bad = Text('x\ud800')
for args in [(bad, 42), (b'', bad)]:
    try:
        escape_decode(*args)
    except UnicodeEncodeError as error:
        assert error.object is bad
        assert (error.encoding, error.start, error.end, error.reason) == ('utf-8', 1, 2, 'surrogates not allowed')
        assert error.__traceback__ is not None
    else:
        assert False
data = bytearray(b'\\x41')
assert escape_decode(data) == (b'A', 4)
data.extend(b'Z')
assert escape_decode(memoryview(data)) == (b'AZ', 5)
try:
    escape_decode(memoryview(data)[::2])
except BufferError:
    pass
else:
    assert False
view = memoryview(data)
view.release()
try:
    escape_decode(view)
except ValueError:
    pass
else:
    assert False
for policy in ('strict', 'replace', 'ignore', 'unknown'):
    try:
        escape_decode(b'\\', policy)
    except ValueError as error:
        assert error.args == ('Trailing \\ in string',)
    else:
        assert False
assert escape_decode(b'\\x0Z', 'replace') == (b'?Z', 4)
assert escape_decode(b'\\x0Z', 'ignore') == (b'Z', 4)
with warnings.catch_warnings(record=True) as seen:
    warnings.simplefilter('always')
    assert escape_decode(b'\\q\\400') == (b'\\q\x00', 6)
    assert len(seen) == 1
    assert seen[0].category is DeprecationWarning
    assert str(seen[0].message) == 'b"\\q" is an invalid escape sequence. Such sequences will not work in the future. '
with warnings.catch_warnings(record=True) as seen:
    warnings.simplefilter('always')
    try:
        escape_decode(b'\\q\\x')
    except ValueError as error:
        assert error.args == ('invalid \\x escape at position 2',)
    else:
        assert False
    assert len(seen) == 0
with warnings.catch_warnings():
    warnings.simplefilter('error')
    try:
        escape_decode(b'\\400')
    except DeprecationWarning as error:
        assert str(error) == 'b"\\400" is an invalid octal escape sequence. Such sequences will not work in the future. '
        assert error.__traceback__ is not None
    else:
        assert False
`
  },
  {
    name: "readbuffer_encode native copying, subtype and argument contracts",
    source: String.raw`from _codecs import readbuffer_encode

class Text(str):
    def __str__(self):
        raise AssertionError('virtual text')
class Buffer(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes')
    def __len__(self):
        raise AssertionError('virtual length')
for source, expected in [(b'abc', b'abc'), (Buffer(b'abc'), b'abc'), (Text('é🐍'), b'\xc3\xa9\xf0\x9f\x90\x8d')]:
    result = readbuffer_encode(source, Text('unknown'))
    assert result == (expected, len(expected))
    assert type(result[0]) is type(b'')
    assert result[0] is not source
empty = b''
assert readbuffer_encode(empty, None)[0] is empty
for args, message in [((), 'readbuffer_encode expected at least 1 argument, got 0'), ((b'', None, None), 'readbuffer_encode expected at most 2 arguments, got 3'), ((None,), "a bytes-like object is required, not 'NoneType'"), (([],), "a bytes-like object is required, not 'list'"), ((b'', 42), 'readbuffer_encode() argument 2 must be str or None, not int')]:
    try:
        readbuffer_encode(*args)
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
try:
    readbuffer_encode(data=b'')
except TypeError as error:
    assert error.args == ('_codecs.readbuffer_encode() takes no keyword arguments',)
else:
    assert False
try:
    readbuffer_encode(b'', 'unknown\0')
except ValueError as error:
    assert error.args == ('embedded null character',)
else:
    assert False
bad = Text('prefix\ud800suffix')
for args in [(bad, 42), (bad, 'ignore'), (b'', bad)]:
    try:
        readbuffer_encode(*args)
    except UnicodeEncodeError as error:
        assert error.object is bad
        assert error.args[1] is bad
        assert (error.encoding, error.start, error.end, error.reason) == ('utf-8', 6, 7, 'surrogates not allowed')
    else:
        assert False
`,
  },
  {
    name: "Punycode public decoder factories retain rewritten exception chains and tracebacks",
    source: String.raw`import codecs
import encodings.punycode
for decode in (lambda data: codecs.decode(data, 'punycode'), lambda data: codecs.getdecoder('punycode')(data), lambda data: codecs.getincrementaldecoder('punycode')().decode(data, True), lambda data: encodings.punycode.punycode_decode(data, 'strict')):
    for data, inner_object, start, end, reason in (
        (b'A\xff-z', b'A\xff', 1, 2, 'ordinal not in range(128)'),
        (b'abc-z', b'Z', 1, 2, 'incomplete punycode string'),
        (b'abc-?', b'?', 0, 1, "Invalid extended code point '63'"),
    ):
        outer = ValueError('active')
        try:
            try:
                raise outer
            except ValueError:
                decode(data)
        except UnicodeDecodeError as error:
            assert error.__traceback__ is not None
            assert error.__cause__ is None
            assert error.__suppress_context__ is True
            assert error.object == data
            inner = error.__context__
            assert type(inner) is UnicodeDecodeError
            assert inner.args == (error.encoding, inner_object, start, end, reason)
            assert inner.__traceback__ is not None
            assert inner.__cause__ is None
            assert inner.__suppress_context__ is False
            if data == b'abc-z':
                indexing = inner.__context__
                assert type(indexing) is IndexError
                assert indexing.args == ('index out of range',)
                assert indexing.__traceback__ is not None
                assert indexing.__context__ is outer
            else:
                assert inner.__context__ is outer
        else:
            assert False
`,
  },
  {
    name: "charmap surrogateescape retains original decode exception arguments",
    source: `import codecs
for mapping in ({}, '', '\\ufffe' * 256):
    source = b'\\xff\\xfea'
    try:
        codecs.charmap_decode(source, 'surrogateescape', mapping)
    except UnicodeDecodeError as error:
        assert error.args == ('charmap', source, 0, 1, 'character maps to <undefined>')
        assert (error.start, error.end, error.reason) == (2, 3, 'character maps to <undefined>')
        assert error.object == source
        assert error.__traceback__ is not None
    else:
        assert False
source = b'\\x80\\x70'
try:
    source.decode('cp424', 'surrogateescape')
except UnicodeDecodeError as error:
    assert error.args == ('charmap', source, 0, 1, 'character maps to <undefined>')
    assert (error.start, error.end) == (1, 2)
    assert error.__traceback__ is not None
else:
    assert False
`,
  },
  {
    name: "normalized search names retain identity across misses and cache invalidation",
    source: `import codecs
seen = []
mode = 'miss'
info = (None, None, None, None)
def search(name):
    seen.append(name)
    if mode == 'failure':
        raise ValueError('search failed')
    if mode == 'success':
        return info
codecs.register(search)
for spelling, mode in [('Codec-Identity-Probe', 'miss'), ('CODEC IDENTITY PROBE', 'failure'), ('codec_identity_probe', 'success')]:
    try:
        codecs.lookup(spelling)
    except (LookupError, ValueError):
        pass
codecs.unregister(search)
codecs.register(search)
assert codecs.lookup('codec-identity-probe') is info
assert len(seen) == 4
for name in seen:
    assert name is seen[0]
`,
  },
  {
    name: "callback failures preserve identity, notes and guest traceback frames",
    source: `import codecs
failure = ValueError('callback failed')
def codec(value):
    raise failure
codecs.register(lambda name: (codec, codec, None, None) if name == 'public_traceback' else None)
for operation, value in [(codecs.encode, 'x'), (codecs.decode, b'x')]:
    failure.__traceback__ = None
    try:
        operation(value, 'public_traceback')
    except ValueError as error:
        assert error is failure and error.args == ('callback failed',)
        traceback = error.__traceback__
        assert traceback.tb_frame.f_code.co_name == '<module>'
        assert traceback.tb_next.tb_frame.f_code.co_name == 'codec'
        assert traceback.tb_next.tb_next is None
    else:
        assert False
assert failure.__notes__ == ["encoding with 'public_traceback' codec failed", "decoding with 'public_traceback' codec failed"]
`,
  },
  {
    name: "generator error callbacks are rejected without starting their body",
    source: `import codecs
events = []
def handler(error):
    events.append('started')
    yield ('?', 1)
codecs.register_error('public_generator', handler)
for operation, expected in [(lambda: b'\\xff'.decode('ascii', 'public_generator'), 'decoding error handler must return (str, int) tuple'), (lambda: 'é'.encode('ascii', 'public_generator'), 'encoding error handler must return (str/bytes, int) tuple')]:
    try:
        operation()
    except TypeError as error:
        assert error.args == (expected,)
    else:
        assert False
assert events == []
`,
  },
  {
    name: "handler result validation precedes index and mutated-object validation",
    source: `import codecs
events = []
class Index:
    def __index__(self):
        events.append('index')
        return 1
def handler(error):
    error.object = None
    return (b'?', Index())
codecs.register_error('public_validation', handler)
try:
    b'\\xff'.decode('ascii', 'public_validation')
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    assert False
assert events == []
def handler(error):
    error.object = None
    return ('?', Index())
codecs.register_error('public_validation', handler)
try:
    b'\\xff'.decode('ascii', 'public_validation')
except TypeError as error:
    assert error.args == ("UnicodeError 'object' attribute must be a bytes",)
else:
    assert False
assert events == ['index']
`,
  },
  {
    name: "CodecInfo tuple layout, metadata, subclassing and attribute independence",
    source: `import codecs
def encode(value, errors='strict'):
    return (b'encoded', len(value))
def decode(value, errors='strict'):
    return ('decoded', len(value))
class Info(codecs.CodecInfo):
    pass
info = Info(encode, decode, name='custom')
assert isinstance(info, tuple)
assert type(info) is Info
assert len(info) == 4
assert tuple(info) == (encode, decode, None, None)
assert info.encode is encode and info.decode is decode
assert info.incrementalencoder is None and info.incrementaldecoder is None
assert info.name == 'custom' and info._is_text_encoding is True
info.encode = None
assert info[0] is encode and info.encode is None
assert codecs.CodecInfo.__module__ == 'codecs'
`,
  },
  {
    name: "search normalization, cache identity, duplicate registration and invalidation",
    source: `import codecs
events = []
info = codecs.CodecInfo(lambda value: (value, 0), lambda value: (value, 0), name='public_test')
def search(name):
    events.append(name)
    if name == 'public_test':
        return info
codecs.register(search)
codecs.register(search)
assert codecs.lookup(' PUBLIC---TEST ') is info
assert codecs.lookup('public_test') is info
assert events == ['public_test']
codecs.unregister(search)
assert codecs.lookup('public_test') is info
assert events == ['public_test', 'public_test']
codecs.unregister(search)
try:
    codecs.lookup('public_test')
except LookupError as error:
    assert error.args == ('unknown encoding: public_test',)
else:
    assert False
`,
  },
  {
    name: "recursive handlers and exception.object mutation after __index__",
    source: `import codecs
events = []
replacement = b'ABCD'
class Index:
    def __index__(self):
        events[-1].object = replacement
        return -2
def handler(error):
    events.append(error)
    if len(events) == 1:
        assert b'\\xff'.decode('ascii', 'public_recursive') == '?CD'
        error.object = b'WXYZ'
        return ('!', -1)
    return ('?', Index())
codecs.register_error('public_recursive', handler)
assert b'\\xff'.decode('ascii', 'public_recursive') == '!Z'
assert len(events) == 2
assert events[0] is not events[1]
assert events[0].args == ('ascii', b'\\xff', 0, 1, 'ordinal not in range(128)')
assert events[1].object is replacement
`,
  },
  {
    name: "all standard handlers through published registry identities",
    source: `import codecs
import _codecs
error = UnicodeEncodeError('ascii', 'é', 0, 1, 'reason')
for name, result in [('ignore', ''), ('replace', '?'), ('backslashreplace', '\\\\xe9'), ('xmlcharrefreplace', '&#233;'), ('namereplace', '\\\\N{LATIN SMALL LETTER E WITH ACUTE}')]:
    handler = codecs.lookup_error(name)
    assert handler(error) == (result, 1)
    assert handler is getattr(codecs, name + '_errors')
    assert handler is _codecs.lookup_error(name)
try:
    codecs.lookup_error('strict')(error)
except UnicodeEncodeError as caught:
    assert caught is error
    assert caught.__traceback__ is not None
else:
    assert False
assert codecs.lookup_error('surrogateescape')(UnicodeDecodeError('ascii', b'\\xff', 0, 1, 'reason')) == ('\\udcff', 1)
assert codecs.lookup_error('surrogatepass')(UnicodeEncodeError('utf-8', '\\ud800', 0, 1, 'reason')) == (b'\\xed\\xa0\\x80', 1)
`,
  },
  {
    name: "standard handler rejection chains the active exception without changing cause",
    source: `import codecs
for name in ('strict', 'surrogatepass', 'surrogateescape'):
    original = UnicodeEncodeError('ascii', 'é', 0, 1, 'original')
    arguments = original.args
    prior = ValueError('active')
    cause = ValueError('explicit cause')
    original.__cause__ = cause
    try:
        raise prior
    except ValueError:
        prior.__context__ = original
        try:
            codecs.lookup_error(name)(original)
        except UnicodeEncodeError as caught:
            assert caught is original
            assert caught.__context__ is prior
            assert prior.__context__ is None
            assert caught.__cause__ is cause
            assert caught.__suppress_context__ is True
            assert caught.args is arguments
        else:
            assert False
    try:
        codecs.lookup_error(name)(original)
    except UnicodeEncodeError as caught:
        assert caught.__context__ is prior
    else:
        assert False
`,
  },
  {
    name: "custom codecs shared by encode/decode and str/bytes constructors",
    source: `import codecs
events = []
def encode(value, errors='strict'):
    events.append(('encode', value, errors))
    return (b'custom', len(value))
def decode(value, errors='strict'):
    events.append(('decode', bytes(value), errors))
    return ('custom', len(value))
def search(name):
    if name == 'public_consumer':
        return codecs.CodecInfo(encode, decode, name=name)
codecs.register(search)
assert 'x'.encode('public_consumer') == b'custom'
assert bytes('x', 'public_consumer') == b'custom'
assert codecs.encode('x', 'public_consumer') == b'custom'
assert b'x'.decode('public_consumer') == 'custom'
assert str(b'x', 'public_consumer') == 'custom'
assert codecs.decode(b'x', 'public_consumer') == 'custom'
assert events == [('encode', 'x', 'strict')] * 3 + [('decode', b'x', 'strict')] * 3
`,
  },
  {
    name: "core fast paths survive codec shadowing and distinguish handler shadowing",
    source: `import codecs
events = []
def search(name):
    events.append(name)
    return (None, None, None, None)
def handler(error):
    return ('!', error.end)
codecs.register(search)
for encoding in ('ascii', 'latin-1', 'utf-8'):
    assert 'A'.encode(encoding) == b'A'
    assert b'A'.decode(encoding) == 'A'
assert events == []
codecs.register_error('replace', handler)
codecs.register_error('strict', handler)
assert '\\ud800'.encode('utf-8', 'replace') == b'?'
assert '\\ud800'.encode('utf-8', 'strict') == b'!'
try:
    'é'.encode('ascii', 'strict')
except UnicodeEncodeError as error:
    assert (error.encoding, error.object, error.start, error.end, error.reason) == ('ascii', 'é', 0, 1, 'ordinal not in range(128)')
else:
    assert False
`,
  },
  {
    name: "decoder subtype identity and tuple override avoidance",
    source: `import codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual item')
    def __len__(self):
        raise AssertionError('virtual length')
def decode(value, errors='strict'):
    return Pair((result, None))
codecs.register(lambda name: codecs.CodecInfo(None, decode, name=name) if name == 'public_subtype' else None)
for content in ('', 'A', 'é', 'Ā', 'two', '\\ud800'):
    result = Text(content)
    assert codecs.decode(b'x', 'public_subtype') is result
    for actual in (b'x'.decode('public_subtype'), str(b'x', 'public_subtype')):
        if content in ('', 'A', 'é'):
            assert type(actual) is str and actual is content
        else:
            assert actual is result
`,
  },
  {
    name: "incremental UTF-8 split input, state restoration, reset and final failure",
    source: `import codecs
import encodings.utf_8
factory = codecs.getincrementaldecoder('utf8')
assert factory is encodings.utf_8.IncrementalDecoder
decoder = factory()
assert isinstance(decoder, codecs.BufferedIncrementalDecoder)
assert decoder.decode(b'\\xf0\\x9f') == ''
state = decoder.getstate()
assert state == (b'\\xf0\\x9f', 0)
assert decoder.decode(b'\\x90\\x8d', True) == '🐍'
decoder.setstate(state)
try:
    decoder.decode(b'', True)
except UnicodeDecodeError as error:
    assert (error.object, error.start, error.end, error.reason) == (b'\\xf0\\x9f', 0, 2, 'unexpected end of data')
else:
    assert False
assert decoder.getstate() == state
decoder.reset()
assert decoder.getstate() == (b'', 0)
`,
  },
  {
    name: "stream reader/writer adapters over a real in-memory binary stream",
    source: `import codecs
import io
stream = io.BytesIO()
writer = codecs.getwriter('utf8')(stream)
writer.write('é\\n🐍\\n')
writer.writelines(['A', 'B'])
assert stream.getvalue() == b'\\xc3\\xa9\\n\\xf0\\x9f\\x90\\x8d\\nAB'
stream.seek(0)
reader = codecs.getreader('utf8')(stream)
assert reader.readline() == 'é\\n'
assert reader.readline() == '🐍\\n'
assert reader.read() == 'AB'
assert reader.read() == ''
reader.seek(0)
assert reader.read() == 'é\\n🐍\\nAB'
`,
  },
  {
    name: "owned charmap module and undefined-character recovery",
    source: `import codecs
import encodings.charmap
info = encodings.charmap.getregentry()
assert info.name == 'charmap'
assert isinstance(info, codecs.CodecInfo)
assert codecs.charmap_decode(b'\\x00\\x01', 'strict', 'BA') == ('BA', 2)
assert codecs.charmap_encode('BA', 'strict', {66: 0, 65: 1}) == (b'\\x00\\x01', 2)
events = []
def handler(error):
    events.append((error.encoding, error.object, error.start, error.end, error.reason))
    return ('?', error.end)
codecs.register_error('public_charmap', handler)
assert codecs.charmap_decode(b'\\x00\\x01', 'public_charmap', 'A\\ufffe') == ('A?', 2)
assert events == [('charmap', b'\\x00\\x01', 1, 2, 'character maps to <undefined>')]
`,
  },
  {
    name: "UTF-16/32 rejected replacements restore cached faults and retain incremental BOM state",
    source: `import codecs
for encoding in ('utf-16', 'utf-16-le', 'utf-16-be', 'utf-32', 'utf-32-le', 'utf-32-be'):
    for replacement in ('\\ud800', b'!'):
        for reused in (False, True):
            source = '\\ud800A\\udfffZ'
            seen = []
            events = []
            class Position:
                def __index__(self):
                    events.append('index')
                    seen[-1].start = 90
                    seen[-1].end = 91
                    seen[-1].reason = 'index mutation'
                    return -1
            def handler(error):
                seen.append(error)
                if reused and len(seen) == 1:
                    return ('?', error.end)
                error.encoding = 'changed encoding'
                error.object = 'changed object'
                error.start = 42
                error.end = 43
                error.reason = 'changed reason'
                return (replacement, Position())
            codecs.register_error('public_wide_rejection', handler)
            encoder = codecs.getincrementalencoder(encoding)('public_wide_rejection')
            state = encoder.getstate()
            try:
                encoder.encode(source)
            except UnicodeEncodeError as error:
                assert error is seen[0] and error is seen[-1]
                assert error.encoding == 'changed encoding'
                assert error.object == 'changed object'
                assert (error.start, error.end, error.reason) == ((2, 3, 'surrogates not allowed') if reused else (0, 1, 'surrogates not allowed'))
                assert error.args == (encoding, source, 0, 1, 'surrogates not allowed')
                assert error.__traceback__ is not None
            else:
                assert False
            assert encoder.getstate() == state
            assert events == ['index']
            assert len(seen) == (2 if reused else 1)
            assert encoder.encode('A') == 'A'.encode(encoding)
`,
  },
] as const;
