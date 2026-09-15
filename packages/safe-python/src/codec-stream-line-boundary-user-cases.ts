/** Unchanged guest programs shared with the pinned external differential oracle. */
export const codecStreamLineBoundaryUserCases = [
  'utf-8', 'utf-8-sig', 'utf-7', 'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be',
].flatMap(encoding => [1, 3].flatMap(chunk => [false, true].map(keepends => ({
  name: `${encoding}; chunk=${chunk}; keepends=${keepends}`,
  source: `import codecs
events = []
failure = OSError('read failure')
class Stream:
    def __init__(self, data):
        self.data = data
        self.position = 0
        self.broken = True
    def read(self, size=-1):
        events.append(('read', size, self.position))
        if self.broken and self.position >= ${chunk}:
            self.broken = False
            raise failure
        count = ${chunk} if size < 0 else min(size, ${chunk})
        result = self.data[self.position:self.position + count]
        self.position += len(result)
        return result
    def seek(self, offset, whence=0):
        events.append(('seek', offset, whence))
        self.position = offset
        return offset
class Keep:
    def __bool__(self):
        events.append('keepends')
        return ${keepends ? 'True' : 'False'}
for boundary in ('\\n', '\\r', '\\r\\n', '\\v', '\\f', '\\x1c', '\\x1d', '\\x1e', '\\x85', '\\u2028', '\\u2029'):
    events.clear()
    text = 'é' + boundary + '😀' + boundary + 'Z'
    stream = Stream(text.encode('${encoding}'))
    reader = codecs.getreader('${encoding}')(stream)
    print('boundary', ord(boundary[0]), len(boundary))
    for step in range(5):
        try:
            result = reader.readline(keepends=Keep())
            print('line', repr(result), type(result).__name__)
        except OSError as error:
            print('failure', error is failure, type(error).__name__, error.args)
        print('state', reader.bytebuffer, repr(reader.charbuffer), reader.linebuffer, stream.position, events)
        events.clear()
    print('seek', reader.seek(0), reader.bytebuffer, repr(reader.charbuffer), reader.linebuffer)
    print('replay', reader.readlines(keepends=${keepends ? 'True' : 'False'}), stream.position)
    print('events', events)
`,
}))));
