/** Unchanged guest programs for the pinned external oracle and PythonSession. */
export const signatureCallbackStateAuditCases = [
  {name: "encoder reset during negative-position recovery", source: `
import codecs
encoder = codecs.getincrementalencoder('utf-8-sig')('audit')
events = []
def recover(error):
    events.append((encoder.getstate(), error.object, error.start, error.end))
    encoder.reset()
    return ('?', -1)
codecs.register_error('audit', recover)
print(encoder.encode('A\\ud800Z'), encoder.getstate())
print(encoder.encode('B', True), encoder.getstate())
print(events)
`},
  {name: "decoder input replacement retains original buffered slicing", source: `
import codecs
decoder = codecs.getincrementaldecoder('utf-8-sig')('audit')
events = []
def recover(error):
    events.append((decoder.getstate(), error.object, error.start, error.end))
    error.object = b'Z\\xe2'
    return ('?', -2)
codecs.register_error('audit', recover)
print(repr(decoder.decode(b'\\xef')))
print(repr(decoder.decode(b'\\xbb\\xbf\\xffA')), decoder.getstate())
print(events)
`},
  {name: "decoder reset persists after a guest callback failure", source: `
import codecs
decoder = codecs.getincrementaldecoder('utf-8-sig')('audit')
failure = RuntimeError('callback')
def recover(error):
    print(decoder.getstate(), error.object, error.start, error.end)
    decoder.reset()
    raise failure
codecs.register_error('audit', recover)
print(repr(decoder.decode(b'\\xef')))
try:
    decoder.decode(b'\\xbb\\xbf\\xff')
except RuntimeError as error:
    print(error is failure, error.args, decoder.getstate())
print(repr(decoder.decode(b'\\xef\\xbb\\xbfZ', True)), decoder.getstate())
`}
] as const;
