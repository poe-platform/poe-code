export const codecStreamStateCases = [
  {name:'base class state and buffer mutation', source:`
import codecs
for cls, operation, initial in ((codecs.IncrementalEncoder, 'encode', 0), (codecs.IncrementalDecoder, 'decode', (b'', 0))):
    marker = []
    codec = cls(marker)
    assert codec.errors is marker
    assert codec.getstate() == initial
    assert codec.setstate(object()) is None
    assert codec.reset() is None
    try:
        getattr(codec, operation)(None, object())
    except NotImplementedError:
        pass
    else:
        assert False
class Encoder(codecs.BufferedIncrementalEncoder):
    def _buffer_encode(self, data, errors, final):
        assert errors is policy
        events.append((data, final))
        self.buffer = 'overwritten'
        return data[:-1].encode(), len(data) - 1
policy = []
events = []
encoder = Encoder(policy)
assert encoder.encode('ab') == b'a'
assert encoder.getstate() == 'b'
assert encoder.encode('cd', True) == b'bc'
assert encoder.getstate() == 'd'
assert events == [('ab', False), ('bcd', True)]
encoder.setstate(0)
assert encoder.buffer == ''
encoder.setstate('x')
encoder.reset()
assert encoder.getstate() == 0
class Decoder(codecs.BufferedIncrementalDecoder):
    def _buffer_decode(self, data, errors, final):
        if final:
            raise ValueError('final')
        return data[:-1].decode(), len(data) - 1
decoder = Decoder()
assert decoder.decode(b'ab') == 'a'
assert decoder.getstate() == (b'b', 0)
state = [b'z', object()]
decoder.setstate(state)
assert decoder.buffer is state[0]
try:
    decoder.decode(b'q', True)
except ValueError as error:
    assert error.args == ('final',)
else:
    assert False
assert decoder.getstate() == (b'z', 0)
decoder.reset()
assert decoder.getstate() == (b'', 0)
`},
  {name:'concrete ASCII Latin-1 and UTF-8 adapters', source:`
from encodings import ascii, latin_1, utf_8
for module, text, data in ((ascii, 'A', b'A'), (latin_1, 'é', b'\\xe9'), (utf_8, 'é', b'\\xc3\\xa9')):
    encoder = module.IncrementalEncoder()
    decoder = module.IncrementalDecoder()
    assert encoder.encode(text, True) == data
    assert decoder.decode(data, True) == text
    assert encoder.getstate() == 0
    assert decoder.getstate() == (b'', 0)
    info = module.getregentry()
    assert info.incrementalencoder is module.IncrementalEncoder
    assert info.streamreader is module.StreamReader
    assert info.encode(text) == (data, len(text))
decoder = utf_8.IncrementalDecoder()
assert decoder.decode(b'\\xe2') == ''
assert decoder.getstate() == (b'\\xe2', 0)
assert decoder.decode(b'\\x82') == ''
try:
    decoder.decode(b'', True)
except UnicodeDecodeError as error:
    assert (error.object, error.start, error.end, error.reason) == (b'\\xe2\\x82', 0, 2, 'unexpected end of data')
else:
    assert False
assert decoder.getstate() == (b'\\xe2\\x82', 0)
assert decoder.decode(b'\\xac', True) == '€'
`},
  {name:'short reads, line buffers, positioning and writes', source:`
import codecs
class Stream:
    def __init__(self, data):
        self.data = data
        self.position = 0
        self.events = []
    def read(self, size=-1):
        self.events.append(('read', size))
        size = 1 if size != 0 else 0
        result = self.data[self.position:self.position + size]
        self.position += len(result)
        return result
    def write(self, data):
        self.events.append(('write', data))
        return 123
    def seek(self, offset, whence=0):
        self.events.append(('seek', offset, whence))
        self.position = offset
        return 456
    def tell(self):
        return self.position
    def close(self):
        self.events.append(('close',))
class Reader(codecs.StreamReader):
    decode = codecs.utf_8_decode
class Writer(codecs.StreamWriter):
    encode = codecs.utf_8_encode
stream = Stream(b'a\\r\\n\\xc3\\xa9\\nlast')
reader = Reader(stream)
assert reader.read(0) == ''
assert stream.events == []
assert reader.readline() == 'a\\r\\n'
assert reader.readline(keepends=False) == 'é'
assert reader.readlines() == ['last']
assert reader.tell() == len(stream.data)
assert reader.seek(0) is None
assert reader.read(1) == 'a'
assert reader.reset() is None
assert reader.tell() == 1
writer = Writer(stream)
assert writer.write('é') is None
assert writer.writelines(['a', 'b']) is None
assert stream.events[-2:] == [('write', b'\\xc3\\xa9'), ('write', b'ab')]
assert writer.seek(0) is None
with writer as same:
    assert same is writer
assert stream.events[-1] == ('close',)
for wrapper in (reader, writer):
    try:
        wrapper.__reduce_ex__(4)
    except TypeError as error:
        assert error.args == ("can't serialize " + type(wrapper).__name__,)
    else:
        assert False
`},
  {name:'paired reader writer and recoder protocols', source:`
import codecs
class Stream:
    def __init__(self):
        self.events = []
    def seek(self, *args):
        self.events.append(('seek', args))
    def close(self):
        self.events.append(('close',))
    def tell(self):
        return 42
class Reader:
    def __init__(self, stream, errors):
        self.stream = stream
        self.errors = errors
    def read(self, size=-1):
        self.stream.events.append(('read', size))
        return 'é\\nx'
    def readline(self, size=None, keepends=True):
        self.stream.events.append(('readline', size, keepends))
        return 'é\\n'
    def readlines(self, sizehint=None, keepends=True):
        return ['é\\n', 'x']
    def __next__(self):
        return 'é\\n'
    def reset(self):
        self.stream.events.append(('reader.reset',))
    def seek(self, *args):
        self.stream.events.append(('reader.seek', args))
class Writer:
    def __init__(self, stream, errors):
        self.stream = stream
    def write(self, data):
        self.stream.events.append(('write', data))
        return 7
    def writelines(self, lines):
        return 8
    def reset(self):
        self.stream.events.append(('writer.reset',))
    def seek(self, *args):
        self.stream.events.append(('writer.seek', args))
stream = Stream()
wrapper = codecs.StreamReaderWriter(stream, Reader, Writer)
assert wrapper.reader.stream is stream and wrapper.writer.stream is stream
assert wrapper.read(3) == 'é\\nx'
assert wrapper.readline(2, False) == 'é\\n'
assert wrapper.readlines(1, False) == ['é\\n', 'x']
assert wrapper.write('a') == 7
assert wrapper.writelines(['a']) == 8
assert iter(wrapper) is wrapper
assert next(wrapper) == 'é\\n'
assert wrapper.seek(0) is None
assert stream.events[-3:] == [('seek', (0, 0)), ('reader.reset',), ('writer.reset',)]
assert wrapper.tell() == 42
recoder = codecs.StreamRecoder(stream, codecs.latin_1_encode, codecs.latin_1_decode, Reader, Writer)
assert recoder.read() == b'\\xe9\\nx'
assert recoder.readline() == b'\\xe9\\n'
assert recoder.readlines(object()) == [b'\\xe9\\n', b'x']
assert recoder.write(b'\\xe9') == 7
assert recoder.writelines([b'\\xe9', b'x']) == 7
assert stream.events[-1] == ('write', 'éx')
assert iter(recoder) is recoder
assert next(recoder) == b'\\xe9\\n'
assert recoder.seek(2, 1) is None
assert stream.events[-2:] == [('reader.seek', (2, 1)), ('writer.seek', (2, 1))]
`}
] as const;
