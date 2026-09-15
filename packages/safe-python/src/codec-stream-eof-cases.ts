/** Identical guest programs for the pinned oracle and explicit input services. */
export const codecStreamEofCases = [
  {
    name: 'UTF-8 stream temporary EOF retains incomplete input and resumes',
    input: 'e2\n-\n82ac0d\n-\n0a5a\n-\n-\n-\n',
    source: `
import codecs
class Stream:
    def __init__(self):
        self.calls = []
        self.position = 0
    def read(self, size=-1):
        self.calls.append(size)
        data = input()
        result = b'' if data == '-' else bytes.fromhex(data)
        self.position += len(result)
        return result
    def tell(self):
        return self.position
stream = Stream()
reader = codecs.getreader('utf8')(stream)
for operation in ('read', 'readline', 'readline', 'read'):
    result = getattr(reader, operation)()
    print(operation, repr(result), reader.bytebuffer, repr(reader.charbuffer), reader.linebuffer, reader.tell(), stream.calls)
print(reader.reset(), reader.bytebuffer, repr(reader.charbuffer), reader.linebuffer, reader.tell())
`
  },
  {
    name: 'UTF-8 final failure preserves state for policy changes and retry',
    input: 'e282\n',
    source: `
import codecs
data = bytes.fromhex(input())
for policy in ('strict', 'replace', 'ignore', 'surrogateescape', 'backslashreplace'):
    decoder = codecs.getincrementaldecoder('utf8')()
    print(repr(decoder.decode(data)), decoder.getstate())
    state = decoder.getstate()
    try:
        decoder.decode(b'', True)
    except UnicodeDecodeError as error:
        print(error.args, decoder.getstate() == state)
    decoder.errors = policy
    try:
        print(policy, repr(decoder.decode(b'', True)), decoder.getstate())
    except UnicodeDecodeError as error:
        print(policy, error.args, decoder.getstate())
    decoder.setstate(state)
    print(repr(decoder.decode(b'\\xac', True)), decoder.getstate())
    decoder.setstate(state)
    print(decoder.reset(), decoder.getstate(), repr(decoder.decode(b'A', True)))
for chunks in ((data,), (b'\\xe2', b'\\x82'), (b'', b'\\xe2', b'', b'\\x82', b'')):
    iterator = codecs.iterdecode(chunks, 'utf8')
    try:
        next(iterator)
    except UnicodeDecodeError as error:
        print(error.args)
    try:
        next(iterator)
    except StopIteration as error:
        print(error.args)
`
  },
  ...['ascii', 'latin-1', 'utf-8'].map(encoding => ({
    name: `${encoding} stream retry after sink failure preserves writes and policy`,
    input: '41\n',
    source: `
import codecs
events = []
failure = OSError('sink failure')
class Stream:
    def write(self, data):
        events.append(data)
        print('sink', data.hex())
        if broken:
            raise failure
        return 0
writer = codecs.getwriter('${encoding}')(Stream(), 'replace')
text = bytes.fromhex(input()).decode('ascii') + 'é\\ud800'
broken = True
try:
    writer.write(text)
except OSError as error:
    print(error is failure, error.args, writer.errors)
broken = False
print(writer.write(text), writer.reset(), writer.writelines([text, 'Z']))
print([data.hex() for data in events])
`
  }))
];
