/** Public programs shared by in-memory tests and external interpreter/service
 * replays. The input service decides when to stop; guest recursion is unbounded. */
export const codecCallbackServiceCases = [
  {encoding: "utf-8", prefix: "\\xed", tail: "\\xa0\\x80A", valid: "B"},
  {encoding: "utf-8-sig", prefix: "\\xef", tail: "\\xbb\\xbf\\xed\\xa0\\x80A", valid: "B"},
  {encoding: "utf-16-le", prefix: "\\x00", tail: "\\xd8A\\x00", valid: "B\\x00"},
  {encoding: "utf-16-be", prefix: "\\xd8", tail: "\\x00\\x00A", valid: "\\x00B"},
  {encoding: "utf-32-le", prefix: "\\x00", tail: "\\x00\\x11\\x00A\\x00\\x00\\x00", valid: "B\\x00\\x00\\x00"},
  {encoding: "utf-32-be", prefix: "\\x00", tail: "\\x11\\x00\\x00\\x00\\x00\\x00A", valid: "\\x00\\x00\\x00B"},
].map(({encoding, prefix, tail, valid}) => ({
  encoding,
  setup: `import codecs
events = []
failure = ValueError('service stop')
decoder = codecs.getincrementaldecoder('${encoding}')('service-reentry')
def handler(error):
    events.append(('enter', error.object, error.start, error.end, decoder.getstate()))
    try:
        command = input()
        events.append(('command', command))
        if command == 'stop':
            raise failure
        return (decoder.decode(b'${valid}', True), error.end)
    finally:
        events.append(('leave', decoder.getstate()))
codecs.register_error('service-reentry', handler)
`,
  run: `events.clear()
decoder.errors = 'service-reentry'
assert decoder.decode(b'${prefix}') == ''
try:
    decoder.decode(b'${tail}', True)
except ValueError as caught:
    assert caught is failure
    print('failure', type(caught).__name__, caught.args)
print('events', events)
print('state', decoder.getstate())
decoder.reset()
decoder.errors = 'strict'
print('reset', repr(decoder.decode(b'${valid}', True)), decoder.getstate())
`,
  independent: `assert codecs.lookup_error('service-reentry') is handler
assert decoder.decode(b'${prefix}') == ''
saved = decoder.getstate()
def replacement(error):
    return ('R', len(error.object))
codecs.register_error('service-reentry', replacement)
assert decoder.getstate() == saved
assert decoder.decode(b'${tail}', True) == 'R'
decoder.reset()
decoder.errors = 'strict'
assert decoder.decode(b'${valid}', True) == 'B'
assert decoder.getstate() == (b'', 0)
`,
}));
