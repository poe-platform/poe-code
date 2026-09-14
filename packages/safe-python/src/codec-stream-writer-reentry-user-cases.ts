/** Run unchanged in the interpreter and the pinned external differential oracle. */
export const codecStreamWriterReentryUserCases = [
  'ascii', 'cp1252', 'utf-8', 'utf-8-sig', 'utf-7',
  'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be',
].flatMap(encoding => ['return', 'raise', 'reset', 'reenter'].map(action => ({
  name: `${encoding}; ${action}`,
  source: `import codecs
events = []
failure = OSError('sink failed')
class Result:
    def __index__(self):
        raise AssertionError('sink result must not be converted')
    def __bool__(self):
        raise AssertionError('sink result must not be tested')
class Sink:
    active = False
    def write(self, data):
        events.append(('sink', data, type(data).__name__, 'encode' in writer.__dict__))
        if not self.active:
            self.active = True
            ${action === 'raise' ? "raise failure" : action === 'reset' ? "events.append(('reset', writer.reset()))" : action === 'reenter' ? "events.append(('nested', writer.write('N')))" : 'pass'}
        return Result()
    def seek(self, offset, whence):
        events.append(('seek', offset, whence))
        return Result()
sink = Sink()
writer = codecs.getwriter('${encoding}')(sink)
for data in ('\\ud800', '', 'A', 'é😀', 'Z'):
    try:
        print('write', repr(data), writer.write(data))
    except BaseException as error:
        print('failure', error is failure, type(error).__name__, error.args)
    print('state', 'encode' in writer.__dict__, writer.errors, events)
    events.clear()
    writer.errors = 'backslashreplace'
print('seek', writer.seek(0))
print('replay', writer.writelines(['B', '', 'C']))
print('state', 'encode' in writer.__dict__, writer.errors, events)
`,
})));
