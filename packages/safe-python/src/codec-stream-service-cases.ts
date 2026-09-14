/** Run unchanged with real line-input/text-output services on both interpreters.
 * The guest owns byte buffering and every file-like method; the explicit text
 * services own only reading/writing their already-open descriptors. */
export const codecStreamServiceSource=`
import codecs
class Stream:
    def __init__(self):
        self.buffer = b''
        self.position = 0
    def read(self, size=-1):
        if not self.buffer:
            try:
                self.buffer = (input() + '\\n').encode('utf8')
            except EOFError:
                return b''
        count = 1 if size != 0 else 0
        result = self.buffer[:count]
        self.buffer = self.buffer[count:]
        self.position += len(result)
        return result
    def write(self, value):
        print(value.hex())
    def tell(self):
        return self.position
stream = Stream()
reader = codecs.getreader('utf8')(stream)
writer = codecs.getwriter('utf8')(stream)
assert reader.readline() == 'é\\n'
assert reader.tell() >= 3
writer.write('é\\n')
assert reader.readline() == '🐍\\n'
writer.writelines(['🐍', '\\n'])
assert reader.readlines() == ['A\\n']
assert reader.read() == ''
assert reader.tell() == 10
writer.write('A\\n')
`;

export const codecStreamCancellationCases=[
  {name:'reader.read',body:`
class Stream:
    def read(self, size=-1):
        input()
        events.append('resumed')
        return b'A'
codecs.getreader('utf8')(Stream()).read()
`},
  {name:'writer.write',body:`
class Stream:
    def write(self, value):
        input()
        events.append('resumed')
codecs.getwriter('utf8')(Stream()).write('é')
`},
  {name:'paired.reset',body:`
class Reader:
    def __init__(self, stream, errors):
        pass
    def reset(self):
        input()
        events.append('resumed')
class Writer(Reader):
    def reset(self):
        events.append('writer.reset')
codecs.StreamReaderWriter(None, Reader, Writer).reset()
`},
  {name:'recoder.seek',body:`
class Reader:
    def __init__(self, stream, errors):
        pass
    def seek(self, *args):
        input()
        events.append('resumed')
class Writer(Reader):
    def seek(self, *args):
        events.append('writer.seek')
codecs.StreamRecoder(None, None, None, Reader, Writer).seek(0)
`},
  {name:'incremental handler',body:`
def handler(error):
    input()
    events.append('resumed')
    return ('?', error.end)
codecs.register_error('cancel_stream', handler)
codecs.getincrementaldecoder('utf8')('cancel_stream').decode(b'\\xff', True)
`},
  {name:'iterator source',body:`
def source():
    input()
    events.append('resumed')
    yield 'A'
next(codecs.iterencode(source(), 'utf8'))
`},
  ...['readline', 'readlines', 'tell'].map(operation=>({name:`reader.${operation}`,body:`
class Stream:
    def read(self, size=-1):
        input()
        events.append('resumed')
        return b'A'
    def tell(self):
        input()
        events.append('resumed')
        return 0
codecs.getreader('utf8')(Stream()).${operation}()
`})),
  {name:'writer.writelines source',body:`
class Stream:
    def write(self, value):
        events.append('write')
def lines():
    yield 'A'
    input()
    events.append('resumed')
    yield 'B'
codecs.getwriter('utf8')(Stream()).writelines(lines())
`},
  {name:'buffered decoder consumed index',body:`
class Count:
    def __index__(self):
        input()
        events.append('resumed')
        return 1
class Decoder(codecs.BufferedIncrementalDecoder):
    def _buffer_decode(self, data, errors, final):
        return ('A', Count())
Decoder().decode(b'A', True)
`},
  ...['encode', 'decode'].map(operation=>({name:`iter${operation} final callback`,body:`
class Codec:
    def __init__(self, errors):
        pass
    def ${operation}(self, data, final=False):
        assert final is True
        input()
        events.append('resumed')
        return data
codecs.getincremental${operation === 'encode' ? 'encoder' : 'decoder'} = lambda name: Codec
next(codecs.iter${operation}([], 'unused'))
`})),
  {name:'recoder frontend decoder',body:`
class Backend:
    def __init__(self, stream, errors):
        pass
    def write(self, value):
        events.append('write')
def decode(data, errors):
    input()
    events.append('resumed')
    return ('A', 1)
codecs.StreamRecoder(None, None, decode, Backend, Backend).write(b'A')
`}
].map(({name,body})=>({name,source:`import codecs\nevents = []\n${body}\nraise AssertionError('continued after cancellation')\n`}));
