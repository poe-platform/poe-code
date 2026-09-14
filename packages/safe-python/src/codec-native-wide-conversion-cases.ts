/** Run unchanged through PythonSession and the external pinned CPython oracle. */
export const codecNativeWideConversionCases = ([16, 32] as const).flatMap(width => [
  ...["strict", "ignore", "replace", "surrogateescape", "surrogatepass", "backslashreplace", "xmlcharrefreplace", "namereplace", "missing"].map(policy => ({
    name: `UTF-${width} text conversion corpus: ${policy}`,
    source: String.raw`
width = ${width}
names = ('utf-' + str(width), 'UTF' + str(width), ' utf---' + str(width) + ' ')
policies = ('${policy}',)
texts = ('', 'A', 'é', 'Ā', '🐍', '\ufeffA', '\ufffe', '\ud800', '\udfff', '\ud800A\udfffZ')
inputs = (b'', b'A', b'AB', b'ABC', b'ABCD', b'\xff\xfe', b'\xfe\xff', b'\xff\xfe\x00\x00', b'\x00\x00\xfe\xff', b'\x00\xd8', b'\x00\xdc', b'\x00\xd8\x00\x00', b'\x00\x00\x11\x00', b'\xff\xfeA\x00', b'\xfe\xff\x00A', b'\xff\xfe\x00\x00A\x00\x00\x00', b'\x00\x00\xfe\xff\x00\x00\x00A')
for name in names:
    for policy in policies:
        for text in texts:
            try:
                result = text.encode(name, policy)
                assert type(result) is bytes
                assert bytes(text, name, policy) == result
                print('encode', repr(result))
            except (UnicodeError, LookupError, TypeError) as error:
                print('encode', type(error).__name__, repr(error.args))
        for data in inputs:
            try:
                result = data.decode(name, policy)
                assert type(result) is str
                assert str(data, name, policy) == result
                assert str.__new__(str, data, name, policy) == result
                print('decode', repr(result))
            except (UnicodeError, LookupError, TypeError) as error:
                print('decode', type(error).__name__, repr(error.args))
`,
  })),
  {
    name: `UTF-${width} handler shadowing and search bypass`,
    source: String.raw`
import codecs
import encodings
codecs.unregister(encodings.search_function)
def search(name):
    raise AssertionError(('unexpected search', name))
codecs.register(search)
encoding = 'utf-${width}'
data = ${width === 16 ? "b'\\x00\\xd8'" : "b'\\x00\\xd8\\x00\\x00'"}
for policy in ('strict', 'ignore', 'replace', 'surrogateescape', 'surrogatepass', 'backslashreplace', 'xmlcharrefreplace', 'namereplace'):
    seen = []
    def handler(error):
        seen.append((error.encoding, error.object, error.start, error.end, error.reason))
        return ('?', error.end)
    codecs.register_error(policy, handler)
    print(repr('\ud800'.encode(encoding, policy)))
    print(repr(data.decode(encoding, policy)))
    print(repr(seen))
`,
  },
  {
    name: `UTF-${width} recovery index mutation and callback failure`,
    source: String.raw`
import codecs
encoding = 'utf-${width}'
seen = []
class Position:
    def __index__(self):
        seen.append('index')
        return -1
def encode_handler(error):
    seen.append((error.encoding, error.object, error.start, error.end, error.reason))
    return ('?', Position())
codecs.register_error('wide_resume', encode_handler)
print(repr('\ud800AZ'.encode(encoding, 'wide_resume')), repr(seen))
seen = []
def decode_handler(error):
    seen.append((error.encoding, error.object, error.start, error.end, error.reason))
    error.object = ${width === 16 ? "b'Z\\x00'" : "b'Z\\x00\\x00\\x00'"}
    return ('?', -${width / 8})
codecs.register_error('wide_resume', decode_handler)
print(repr(b'x'.decode(encoding, 'wide_resume')), repr(seen))
failure = ValueError('guest failure')
def failing(error):
    raise failure
codecs.register_error('wide_failure', failing)
for operation in (lambda: '\ud800'.encode(encoding, 'wide_failure'), lambda: b'x'.decode(encoding, 'wide_failure')):
    try:
        operation()
    except ValueError as error:
        assert error is failure
        print(type(error).__name__, repr(error.args))
    else:
        assert False
`,
  },
  {
    name: `UTF-${width} native subtype payload and source identity`,
    source: String.raw`
import codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual text')
    def __iter__(self):
        raise AssertionError('virtual iteration')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes')
    def __len__(self):
        raise AssertionError('virtual length')
encoding = 'utf-${width}'
source = Text('A🐍')
encoded = str.encode(source, encoding)
assert type(encoded) is bytes
print(repr(encoded))
data = Data(encoded)
assert bytes.decode(data, encoding) == source
assert str(data, encoding) == source
source = Text('\ud800')
def handler(error):
    assert error.object is source and error.args[1] is source
    return ('?', error.end)
codecs.register_error('wide_subtype', handler)
print(repr(source.encode(encoding, 'wide_subtype')))
`,
  },
]);
