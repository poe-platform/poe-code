export const codecStreamIteratorCases=[
  {name:'lazy iteration, final flush, kwargs, mutation and failures',source:`
import codecs
assert list(codecs.iterencode(['a', 'é', ''], 'utf-8')) == [b'a', b'\\xc3\\xa9']
assert list(codecs.iterdecode([b'\\xe2', b'\\x82', b'\\xac'], 'utf-8')) == ['€']
events = []
class Encoder:
    def __init__(self, errors, marker):
        events.append(('init', errors, marker))
    def encode(self, value, final=False):
        events.append(('encode', value, final))
        return b'final' if final else value.encode()
info = codecs.CodecInfo(None, None, incrementalencoder=Encoder)
codecs.register(lambda name: info if name == 'stream_custom' else None)
def source():
    events.append('start')
    yield ''
    yield 'a'
    events.append('end')
iterator = codecs.iterencode(source(), 'stream_custom', 'policy', marker=17)
assert events == []
assert next(iterator) == b'a'
assert events == [('init', 'policy', 17), 'start', ('encode', '', False), ('encode', 'a', False)]
assert next(iterator) == b'final'
assert events[-2:] == ['end', ('encode', '', True)]
assert list(iterator) == []
iterator = codecs.iterdecode([b'\\xe2'], 'utf8')
try:
    next(iterator)
except UnicodeDecodeError as error:
    assert error.object == b'\\xe2'
else:
    assert False
assert list(iterator) == []
events.clear()
iterator = codecs.iterencode(['a'], 'stream_custom', marker=2)
assert next(iterator) == b'a'
assert iterator.close() is None
assert events == [('init', 'strict', 2), ('encode', 'a', False)]
`},
  {name:'reader firstline recovery, partial EOF and failed mutations',source:`
import codecs
class Stream:
    def __init__(self, data):
        self.data = data
        self.calls = 0
    def read(self, size=-1):
        self.calls += 1
        result = self.data
        self.data = b''
        return result
    def seek(self, offset, whence):
        raise ValueError('seek')
class Reader(codecs.StreamReader):
    decode = codecs.utf_8_decode
stream = Stream(b'a\\nb\\xff')
reader = Reader(stream)
assert reader.readline(size=2) == 'a\\n'
assert reader.bytebuffer == b'\\xff'
try:
    reader.read()
except UnicodeDecodeError as error:
    assert error.object == b'\\xff'
else:
    assert False
assert reader.charbuffer == 'b'
reader.errors = 'replace'
assert reader.read() == 'b�'
reader.bytebuffer = b'x'
reader.charbuffer = 'y'
reader.linebuffer = ['z']
try:
    reader.seek(0)
except ValueError:
    pass
else:
    assert False
assert (reader.bytebuffer, reader.charbuffer, reader.linebuffer) == (b'x', 'y', ['z'])
reader.reset()
assert (reader.bytebuffer, reader.charbuffer, reader.linebuffer) == (b'', '', None)
reader = Reader(Stream(b'\\xe2\\x82'))
assert reader.read() == ''
assert reader.bytebuffer == b'\\xe2\\x82'
assert reader.read() == ''
assert reader.bytebuffer == b'\\xe2\\x82'
`}
] as const;
