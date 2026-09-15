/** Public text consumers; execute unchanged on the pinned external oracle. */
export const codecEncoderRoutingCases = [
  {
    name: 'core aliases share registered encoders across every text consumer and empty input',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
class Text(str):
    def __str__(self):
        raise AssertionError('input coerced')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('output coerced')
result = Data(b'registry')
def encode(*args):
    events.append(args)
    return (result, object())
def search(name):
    events.append(name)
    return codecs.CodecInfo(encode, None, name=name)
codecs.register(search)
for name in ('u8', 'utf', 'cp65001', '646', 'cp367', 'latin', 'l1', 'cp819'):
    events.clear()
    for contents in ('', 'A'):
        source = Text(contents)
        assert source.encode(name) is result
        assert str.encode(source, name, 'custom') is result
        assert bytes(source, name) is result
        assert bytes.__new__(bytes, source, name, 'custom') is result
        assert events[-4:] == [(source,), (source, 'custom'), (source,), (source, 'custom')]
        for args in events[-4:]:
            assert args[0] is source
    assert events[0] == name and len(events) == 9
events.clear()
for name in ('utf-8', 'ascii', 'latin-1'):
    assert 'A'.encode(name) == b'A'
    assert bytes('', name) == b''
assert events == []
`,
  },
  {
    name: 'all native non-fast-path families consult replacement registry search',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
class Text(str):
    def __str__(self):
        raise AssertionError('input coerced')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('output coerced')
source = Text('')
result = Data(b'registry')
def encode(*args):
    events.append(args)
    return (result, object())
def search(name):
    events.append(name)
    return codecs.CodecInfo(encode, None, name=name)
codecs.register(search)
for name in ('utf_8_sig', 'utf_7', 'u7', 'unicode_1_1_utf_7', 'unicode_escape', 'raw_unicode_escape', 'utf_16_le', 'utf_16_be', 'utf_32_le', 'utf_32_be', 'u16', 'u32', 'punycode', 'cp437', 'charmap'):
    events.clear()
    assert source.encode(name) is result
    assert bytes(source, name, 'custom') is result
    assert events == [name, (source,), (source, 'custom')]
    assert events[1][0] is source and events[2][0] is source
`,
  },
  {
    name: 'native non-fast-path codecs observe nontext flags and result validation',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
calls = []
def encode(*args):
    calls.append(args)
    return ('wrong', None)
info = codecs.CodecInfo(encode, None, name='custom', _is_text_encoding=False)
def search(name):
    return info
codecs.register(search)
for name in ('utf-8-sig', 'utf-7', 'utf-16-le', 'unicode_escape', 'cp437'):
    try:
        'A'.encode(name)
    except LookupError as error:
        assert str(error) == "'" + name + "' is not a text encoding; use codecs.encode() to handle arbitrary codecs"
    else:
        assert False
assert calls == []
info._is_text_encoding = True
for name in ('utf-8-sig', 'utf-7', 'utf-16-le', 'unicode_escape', 'cp437'):
    try:
        'A'.encode(name)
    except TypeError as error:
        assert str(error) == "'" + name + "' encoder returned 'str' instead of 'bytes'; use codecs.encode() to encode to arbitrary types"
    else:
        assert False
assert calls == [('A',)] * 5
`,
  },
  {
    name: 'native non-fast-path codecs retain recursive callback exception identity and notes',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
failure = ValueError('callback failure')
calls = []
def encode(source, errors='strict'):
    calls.append((source, errors))
    if source == 'outer':
        return (bytes('inner', 'utf-8-sig', 'nested'), None)
    raise failure
def search(name):
    return codecs.CodecInfo(encode, None, name=name)
codecs.register(search)
try:
    'outer'.encode('utf-7')
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["encoding with 'utf-8-sig' codec failed", "encoding with 'utf-7' codec failed"]
else:
    assert False
assert calls == [('outer', 'strict'), ('inner', 'nested')]
`,
  },
];

export const codecEncoderRoutingServiceCases = ['search', 'encode'].map(stage => ({
  name: `${stage} callback I/O through a native non-fast-path codec`,
  source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
def encode(source, errors='strict'):
    ${stage === 'encode' ? "assert input() == 'continue'" : 'pass'}
    print('encoded')
    return (b'converted', None)
def search(name):
    ${stage === 'search' ? "assert input() == 'continue'" : 'pass'}
    return codecs.CodecInfo(encode, None, name=name)
codecs.register(search)
try:
    assert 'A'.encode('utf-8-sig') == b'converted'
except BaseException:
    print('caught')
    raise
print('finished')
`,
}));
