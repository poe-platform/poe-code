/** Public programs also replayed unchanged against the pinned external oracle. */
export const codecNativeWideModuleCases = [16, 32].flatMap(width => {
  const setup = `
import codecs
import encodings.utf_${width} as module
name = 'utf-${width}'
unit = ${width / 8}
little = 'utf_${width}_le'
big = 'utf_${width}_be'
bom = codecs.BOM_UTF${width}_LE
text = 'Aé🐍'
data = bom + text.encode(little)
`;
  return [
    {name: `utf-${width} registry and module API`, source: setup + String.raw`
info = codecs.lookup(name)
alias = codecs.lookup('u${width}')
assert alias is codecs.lookup('u${width}') and alias is not info
assert alias.name == info.name and alias.encode is info.encode
assert alias.decode is info.decode
assert type(info) is codecs.CodecInfo
assert info.name == name
assert info.encode is module.encode is getattr(codecs, 'utf_${width}_encode')
assert info.decode is module.decode
assert info.incrementalencoder is module.IncrementalEncoder
assert info.incrementaldecoder is module.IncrementalDecoder
assert info.streamreader is module.StreamReader
assert info.streamwriter is module.StreamWriter
assert module.getregentry() is not info
assert module.encode(text) == (data, len(text))
assert module.decode(data) == (text, len(data))
assert module.decode(text.encode(little)) == (text, len(data) - unit)
assert codecs.encode(text, name) == data
assert codecs.decode(data, name) == text
assert bytes(text, name) == data
`},
    {name: `utf-${width} incremental encoder state and failed first call`, source: setup + String.raw`
encoder = module.IncrementalEncoder()
assert encoder.errors == 'strict' and encoder.encoder is None
assert encoder.getstate() == 2
try:
    encoder.encode('\ud800')
except UnicodeEncodeError as error:
    assert (error.encoding, error.object, error.start, error.end, error.reason) == (name, '\ud800', 0, 1, 'surrogates not allowed')
else:
    assert False
assert encoder.getstate() == 2 and encoder.encoder is None
assert encoder.encode('') == bom
assert encoder.getstate() == 0
assert encoder.encode(text, True) == text.encode(little)
assert encoder.encode('', True) == b''
encoder.reset()
assert encoder.getstate() == 2 and encoder.encode(text) == data
for state in (0, False, [], 1, 2, -1, [0]):
    encoder.setstate(state)
    assert encoder.getstate() == (2 if state else 0)
    assert encoder.encode(text) == (data if state else text.encode(little))
`},
    {name: `utf-${width} every incremental split and state restoration`, source: setup + String.raw`
for byteorder, flag in ((little, 0), (big, 1)):
    prefix = bom if flag == 0 else getattr(codecs, 'BOM_UTF${width}_BE')
    encoded = prefix + text.encode(byteorder)
    for split in range(len(encoded) + 1):
        decoder = module.IncrementalDecoder()
        assert decoder.getstate() == (b'', 2)
        first = decoder.decode(encoded[:split])
        state = decoder.getstate()
        assert state[1] == (2 if split < unit else flag)
        restored = module.IncrementalDecoder()
        restored.setstate(state)
        assert restored.getstate() == state
        assert first + decoder.decode(encoded[split:], True) == text
        assert first + restored.decode(encoded[split:], True) == text
        decoder.reset()
        assert decoder.getstate() == (b'', 2) and decoder.decoder is None
        assert decoder.decode(data, True) == text
for state, byteorder in ((0, little), (1, big)):
    decoder = module.IncrementalDecoder()
    decoder.setstate((b'', state))
    assert decoder.decode(text.encode(byteorder), True) == text
`},
    {name: `utf-${width} missing BOM and truncated input recovery`, source: setup + String.raw`
for errors in ('strict', 'ignore', 'replace'):
    decoder = module.IncrementalDecoder(errors)
    raw = 'A'.encode(little)
    try:
        decoder.decode(raw, True)
    except UnicodeDecodeError as error:
        assert error.args == (name, raw, 0, unit, 'Stream does not start with BOM')
        assert error.object is raw
    else:
        assert False
    assert decoder.getstate() == (b'', 2)
    assert decoder.decode(data, True) == text
decoder = module.IncrementalDecoder()
assert decoder.decode(bom[:1]) == ''
assert decoder.getstate() == (bom[:1], 2)
try:
    decoder.decode(b'', True)
except UnicodeDecodeError as error:
    assert (error.object, error.start, error.end, error.reason) == (bom[:1], 0, 1, 'truncated data')
else:
    assert False
assert decoder.getstate() == (bom[:1], 2)
assert decoder.decode(data[1:], True) == text
`},
    {name: `utf-${width} stream adapters BOM and reset`, source: setup + String.raw`
class Stream:
    def __init__(self, data=b''):
        self.data = data
    def write(self, data):
        self.data += data
    def read(self, size=-1):
        if size < 0:
            size = len(self.data)
        result = self.data[:size]
        self.data = self.data[size:]
        return result
stream = Stream()
writer = codecs.getwriter(name)(stream)
assert writer.encoder is None
writer.write('')
writer.write(text)
writer.write('')
assert stream.data == data
writer.reset()
assert writer.encoder is None
writer.write(text)
assert stream.data == data + data
reader = codecs.getreader(name)(Stream(data))
assert reader.read(1) + reader.read() == text
assert reader.decode is getattr(codecs, little + '_decode')
reader.reset()
assert 'decode' not in reader.__dict__
assert reader.decode(data) == (text, len(data))
reader.reset()
raw = 'A'.encode(little)
try:
    reader.decode(raw)
except UnicodeDecodeError as error:
    assert error.args == (name, raw, 0, unit, 'Stream does not start with BOM')
else:
    assert False
assert 'decode' not in reader.__dict__
`}
  ];
});
