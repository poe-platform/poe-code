/** Identical programs run in PythonSession and the pinned external oracle. */
export const codecStreamReaderReentryUserCases = [
  'utf-8', 'utf-8-sig', 'utf-7', 'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be',
].flatMap(encoding => ['reset', 'reenter', 'raise', 'wrong-type'].map(action => ({
  name: `${encoding}; ${action}`,
  source: `import codecs
events = []
failure = OSError('source advanced then failed')
class Source:
    position = 0
    active = False
    def read(self, size=-1):
        events.append(('read', size, self.position))
        part = self.data[self.position:self.position + 1]
        self.position += len(part)
        if self.position >= 2 and not self.active:
            self.active = True
            ${action === 'reset' ? "events.append(('reset', reader.reset()))" : action === 'reenter' ? "events.append(('nested', reader.read(chars=1)))" : action === 'raise' ? 'raise failure' : "return 'wrong type'"}
        return part
    def seek(self, offset, whence=0):
        events.append(('seek', offset, whence))
        self.position = offset
        return offset
stream = Source()
stream.data = 'é😀\\r\\nZ'.encode('${encoding}')
reader = codecs.getreader('${encoding}')(stream, 'replace')
for step in range(8):
    try:
        value = reader.read(chars=1)
        print('value', repr(value), type(value).__name__)
    except BaseException as error:
        print('failure', error is failure, type(error).__name__, error.args)
    print('state', reader.bytebuffer, repr(reader.charbuffer), reader.linebuffer, stream.position, events)
    events.clear()
print('seek', reader.seek(0))
print('replay', repr(reader.read()), reader.bytebuffer, repr(reader.charbuffer), reader.linebuffer)
print('events', events)
`,
})));
