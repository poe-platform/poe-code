/** Public programs replayed unchanged in the pinned external interpreter. */
export const codecHandlerUnregisterResumeCases = [
  "ascii", "cp1252", "utf-8", "utf-8-sig", "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"
].flatMap(encoding => ["encode", "decode"].map(operation => ({
  name: `${encoding} ${operation} unregister during resume`,
  source: `import codecs
import _codecs
encoding = '${encoding}'
operation = '${operation}'
text = '\\ud800A\\udfffZ'
if operation == 'encode':
    source = text
    worker = codecs.getincrementalencoder(encoding)('remove-during-resume')
else:
    if encoding == 'ascii':
        source = b'\\xffA\\xffZ'
    elif encoding == 'cp1252':
        source = b'\\x81A\\x81Z'
    else:
        source = text.encode(encoding, 'surrogatepass')
    worker = codecs.getincrementaldecoder(encoding)('remove-during-resume')
events = []
retained = []
class Position:
    def __init__(self, error):
        self.error = error
    def __index__(self):
        events.append(('remove', _codecs._unregister_error('remove-during-resume')))
        assert input() == 'ready'
        return self.error.end - len(self.error.object)
def handler(error):
    events.append(('fault', error.start, error.end, worker.getstate()))
    if retained:
        assert error is retained[0]
    else:
        retained.append(error)
    return ('?', Position(error))
codecs.register_error('remove-during-resume', handler)
run = getattr(worker, operation)
print('result', run(source, True), worker.getstate())
print('events', events)
before = worker.getstate()
try:
    run(source, True)
except LookupError as error:
    print('missing', type(error).__name__, error.args, worker.getstate() == before)
else:
    raise AssertionError('removed handler remained available in a new operation')
codecs.register_error('remove-during-resume', lambda error: ('!', error.end))
worker.reset()
print('retry', run(source, True), worker.getstate())
assert _codecs._unregister_error('remove-during-resume')
`
})));
