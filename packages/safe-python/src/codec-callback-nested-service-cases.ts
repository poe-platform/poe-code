/** Additional public programs; the external oracle receives each source unchanged. */
export const codecCallbackNestedServiceCases = [
  {encoding: "utf-8", prefix: "\\xed", tail: "\\xa0\\x80A", valid: "B"},
  {encoding: "utf-8-sig", prefix: "\\xef", tail: "\\xbb\\xbf\\xed\\xa0\\x80A", valid: "B"},
  {encoding: "utf-16-le", prefix: "\\x00", tail: "\\xd8A\\x00", valid: "B\\x00"},
  {encoding: "utf-16-be", prefix: "\\xd8", tail: "\\x00\\x00A", valid: "\\x00B"},
  {encoding: "utf-32-le", prefix: "\\x00", tail: "\\x00\\x11\\x00A\\x00\\x00\\x00", valid: "B\\x00\\x00\\x00"},
  {encoding: "utf-32-be", prefix: "\\x00", tail: "\\x11\\x00\\x00\\x00\\x00\\x00A", valid: "\\x00\\x00\\x00B"},
].map(({encoding, prefix, tail, valid}) => ({
  encoding,
  source: `import codecs
events = []
failure = ValueError('nested service failure')
decoder = codecs.getincrementaldecoder('${encoding}')('nested-service')
def handler(error):
    level = len(events)
    events.append(('enter', level, error.object, error.start, error.end, decoder.getstate()))
    try:
        if input() == 'fail':
            raise failure
        return (decoder.decode(b'${valid}', True), error.end)
    finally:
        events.append(('leave', level, decoder.getstate()))
codecs.register_error('nested-service', handler)
for attempt in range(2):
    events.clear()
    decoder.errors = 'nested-service'
    decoder.decode(b'${prefix}')
    try:
        decoder.decode(b'${tail}', True)
    except ValueError as caught:
        print('failure', type(caught).__name__, caught.args, caught is failure)
    print('events', events)
    print('state', decoder.getstate())
    decoder.reset()
    decoder.errors = 'strict'
    print('reset', repr(decoder.decode(b'${valid}', True)), decoder.getstate())
`,
}));
