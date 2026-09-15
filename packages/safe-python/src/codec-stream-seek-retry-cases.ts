/** Run these complete programs unchanged in the guest and pinned CPython. */
export const codecStreamSeekRetryCases = ["ascii", "latin1", "utf8", "utf7"].flatMap(encoding => [1, 2, 3].map(chunk => ({
  name: `${encoding}, ${chunk}-byte reads`,
  source: `
import codecs
events = []
failure = OSError('seek failed')
class Stream:
    def __init__(self):
        self.position = 0
        self.fail = False
        self.data = b'A\\r\\n\\xc3\\xa9\\n+BCE-\\rZ\\xff\\xe2\\x82'
    def read(self, size=-1):
        count = ${chunk} if size < 0 else min(size, ${chunk})
        data = self.data[self.position:self.position + count]
        self.position += len(data)
        events.append(('read', size, data))
        return data
    def seek(self, offset, whence=0):
        events.append(('seek', offset, whence))
        self.position = offset
        if self.fail:
            raise failure
        return self.position
stream = Stream()
reader = codecs.getreader('${encoding}')(stream)
def state():
    print(reader.bytebuffer, reader.charbuffer, reader.linebuffer, stream.position, events)
    events.clear()
for method, args in (('read', (1,)), ('readline', (1,)), ('read', (-1, 2)), ('readline', ())):
    try:
        print(method, getattr(reader, method)(*args))
    except UnicodeDecodeError as error:
        print(type(error).__name__, error.encoding, error.object, error.start, error.end, error.reason)
    state()
reader.errors = 'backslashreplace'
print('recover', reader.read())
state()
reader.bytebuffer = b'Q'
reader.charbuffer = 'cached'
cache = ['first\\n', 'last']
reader.linebuffer = cache
stream.fail = True
try:
    reader.seek(0)
except OSError as error:
    print(error is failure, error.args, reader.linebuffer is cache)
state()
assert input() == 'continue'
stream.fail = False
print('seek', reader.seek(0), cache)
state()
reader.errors = 'replace'
print('replay', reader.readlines(keepends=False))
state()
print('eof', reader.read(), reader.readline(), reader.readlines())
state()
`,
})));
