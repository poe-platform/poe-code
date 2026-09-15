/** Programs replayed unchanged on the pinned external oracle and public sessions. */
export const punycodeModuleCases = [
  {
    name: "integer decoding preserves guest indexing, input service and failure identity",
    source: `
import encodings.punycode as p
seen = []
failure = ValueError('index callback')
class Digits:
    def __getitem__(self, index):
        seen.append(index)
        assert input() == 'punycode'
        if index == -1:
            return 65
        raise failure
assert p.decode_generalized_number(Digits(), -1, 72, 'strict') == (0, 0)
assert seen == [-1]
try:
    p.decode_generalized_number(Digits(), 7, 72, 'strict')
except ValueError as error:
    assert error is failure
else:
    assert False
assert seen == [-1, 7]
print('verified')
`
  },
  {
    name: "module ownership, registry identities and defaults",
    source: `
import codecs
import encodings
import encodings.punycode as p
assert encodings.punycode is p
assert p.codecs is codecs
assert p.__package__ == 'encodings'
assert p.punycode_decode.__module__ == 'encodings.punycode'
assert p.punycode_decode.__name__ == p.punycode_decode.__qualname__ == 'punycode_decode'
assert p.Codec.encode.__defaults__ == ('strict',)
assert p.IncrementalDecoder.decode.__defaults__ == (False,)
info = codecs.lookup('punycode')
assert type(info) is codecs.CodecInfo and info.name == 'punycode'
assert info.incrementalencoder is p.IncrementalEncoder
assert info.incrementaldecoder is p.IncrementalDecoder
assert info.streamreader is p.StreamReader and info.streamwriter is p.StreamWriter
assert info.encode.__func__ is p.Codec.encode
assert info.decode.__func__ is p.Codec.decode
assert p.getregentry() is not info
`
  },
  {
    name: "integer helpers, insertion ordering and strict failures",
    source: `
import encodings.punycode as p
assert p.selective_len('bücher', 128) == 5
assert p.selective_find('bücher', 'ü', -1, -1) == (1, 1)
assert p.selective_find('bücher', 'ü', 1, 1) == (-1, -1)
assert p.insertion_unsort('bücher', ['ü']) == [745]
assert [p.T(j, 72) for j in range(4)] == [1, 1, 26, 26]
assert p.adapt(745, True, 6) == 0
assert p.decode_generalized_number(b'KVA', 0, 72, 'strict') == (3, 745)
assert p.insertion_sort('bcher', b'KVA', 'strict') == 'bücher'
assert p.decode_generalized_number(b'Z', 0, 72, 'ignore') == (2, None)
assert p.decode_generalized_number(b'?', 0, 72, 'replace') == (1, None)
try:
    p.decode_generalized_number(b'?', 0, 72, 'strict')
except UnicodeDecodeError as error:
    assert error.args == ('punycode', b'?', 0, 1, "Invalid extended code point '63'")
else:
    assert False
`
  },
  {
    name: "encoding helpers and public encoders including surrogates",
    source: String.raw`
import codecs
import encodings.punycode as p
assert p.segregate('bücher') == (b'bcher', ['ü'])
assert p.generate_generalized_integer(745, 72) == b'kva'
assert p.generate_integers(5, [745]) == b'kva'
for text, expected in [('', b''), ('abc', b'abc-'), ('bücher', b'bcher-kva'), ('\ud800', b'ib9b'), ('例え', b'r8jz45g')]:
    assert p.punycode_encode(text) == expected
    assert p.Codec().encode(text, 'unknown') == (expected, len(text))
    assert codecs.encode(text, 'punycode') == expected
    assert text.encode('punycode') == expected
    encoder = p.IncrementalEncoder('unknown')
    assert encoder.getstate() == 0
    assert encoder.encode(text, False) == expected
    assert encoder.encode(text, True) == expected
    encoder.setstate(123)
    encoder.reset()
    assert encoder.getstate() == 0
`
  },
  {
    name: "decoder policies, input variants and stateless incremental splits",
    source: String.raw`
import codecs
import encodings.punycode as p
for value in (b'bcher-kva', 'bcher-kva', memoryview(b'bcher-kva'), bytearray(b'bcher-kva')):
    assert p.punycode_decode(value, 'strict') == 'bücher'
    assert p.Codec().decode(value) == ('bücher', 9)
assert codecs.decode(b'bcher-kva', 'punycode') == 'bücher'
for policy in ('strict', 'replace', 'ignore'):
    decoder = p.IncrementalDecoder(policy)
    assert decoder.getstate() == (b'', 0)
    for final in (False, True):
        assert decoder.decode(b'abc-', final) == 'abc'
    decoder.setstate((b'ignored', 123))
    assert decoder.getstate() == (b'', 0)
    decoder.reset()
for policy in ('ignore', 'replace'):
    assert p.Codec().decode(b'abc-z', policy) == ('abc', 5)
for source in (b'', b'abc-', b'z'):
    try:
        p.IncrementalDecoder('surrogatepass').decode(source)
    except UnicodeError as error:
        assert error.args == ('Unsupported error handling: surrogatepass',)
    else:
        assert False
# Each call is an independent Punycode unit; no partial input is buffered.
decoder = p.IncrementalDecoder()
assert decoder.decode(b'abc-', False) == 'abc'
try:
    decoder.decode(b'z', False)
except UnicodeDecodeError as error:
    assert error.args == ('punycode', b'z', 1, 2, 'incomplete punycode string')
else:
    assert False
assert decoder.getstate() == (b'', 0)
`
  },
  {
    name: "stream adapters preserve serviced calls and guest failures",
    source: `
import codecs
failure = ValueError('stream service')
class Stream:
    def read(self, size=-1):
        assert input() == 'punycode'
        return b'bcher-kva'
reader = codecs.getreader('punycode')(Stream())
assert reader.read(9, 6) == 'bücher'
class Sink:
    def write(self, data):
        assert data == b'bcher-kva'
        raise failure
try:
    codecs.getwriter('punycode')(Sink()).write('bücher')
except ValueError as error:
    assert error is failure
else:
    assert False
print('verified')
`
  }
];
