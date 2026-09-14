/** Unchanged guest programs for the pinned external CPython oracle. */
export const codecStreamMutationCases = [
  {name: 'buffered state truth and indexing preserve mutation on failure', source: `
import codecs
failure = ValueError('state')
events = []
encoder = codecs.BufferedIncrementalEncoder()
class State:
    def __bool__(self):
        events.append('bool')
        encoder.buffer = 'mutated'
        if broken:
            raise failure
        return truth
state = State()
for broken in (False, True):
    for truth in (False, True):
        encoder.buffer = 'before'
        events.clear()
        try:
            print(encoder.setstate(state))
        except ValueError as error:
            print(error is failure)
        print(encoder.buffer is state, encoder.buffer if encoder.buffer is not state else 'state', events)
decoder = codecs.BufferedIncrementalDecoder()
class DecoderState:
    def __getitem__(self, index):
        events.append(index)
        decoder.buffer = b'mutated'
        if broken:
            raise failure
        return marker
marker = []
for broken in (False, True):
    events.clear()
    decoder.buffer = b'before'
    try:
        print(decoder.setstate(DecoderState()))
    except ValueError as error:
        print(error is failure)
    print(decoder.buffer is marker, decoder.getstate(), events)
`},
  {name: 'stream reader bytearray and memoryview short reads preserve native concatenation', source: `
import codecs
for make in (bytes, bytearray, memoryview):
    class Stream:
        def __init__(self):
            self.parts = iter((b'\\xc3', b'\\xa9', b'\\n', b''))
        def read(self, size=-1):
            return make(next(self.parts, b''))
    reader = codecs.getreader('utf8')(Stream())
    try:
        print(make.__name__, repr(reader.readline()), repr(reader.read()), reader.bytebuffer, reader.charbuffer)
    except Exception as error:
        print(make.__name__, type(error).__name__, error.args, reader.bytebuffer, reader.charbuffer)
`},
  {name: 'reader character buffer inplace addition preserves callback identity and failure mutation', source: `
import codecs
failure = ValueError('addition')
events = []
class Buffer:
    def __iadd__(self, value):
        events.append(('iadd', value))
        reader.bytebuffer = b'changed'
        if broken:
            raise failure
        return self
class Stream:
    def __init__(self):
        self.parts = iter((b'ab', b''))
    def read(self):
        return next(self.parts)
class Reader(codecs.StreamReader):
    def decode(self, data, errors):
        events.append(('decode', data, errors))
        return 'text', len(data)
for broken in (False, True):
    events.clear()
    reader = Reader(Stream())
    marker = Buffer()
    reader.charbuffer = marker
    try:
        print(reader.read() is marker)
    except ValueError as error:
        print(error is failure)
    print(reader.charbuffer is marker, reader.bytebuffer, events)
`},
  {name: 'stream delegation preserves descriptor errors and close exception identity', source: `
import codecs
failure = LookupError('descriptor')
events = []
class Stream:
    @property
    def tell(self):
        events.append('tell')
        raise failure
    def close(self):
        events.append('close')
        raise failure
for factory in (lambda stream: codecs.getreader('utf8')(stream), lambda stream: codecs.getwriter('utf8')(stream), lambda stream: codecs.StreamReaderWriter(stream, codecs.getreader('utf8'), codecs.getwriter('utf8')), lambda stream: codecs.StreamRecoder(stream, codecs.utf_8_encode, codecs.utf_8_decode, codecs.getreader('utf8'), codecs.getwriter('utf8'))):
    wrapper = factory(Stream())
    events.clear()
    try:
        wrapper.tell()
    except LookupError as error:
        print(error is failure, events)
    try:
        with wrapper as same:
            print(same is wrapper)
            raise ValueError('body')
    except LookupError as error:
        print(error is failure, type(error.__context__).__name__, error.__context__.args, events)
`}
] as const;
