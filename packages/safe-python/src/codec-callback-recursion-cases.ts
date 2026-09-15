/** Public programs for repeated recursion failure, traceback and decoder recovery.
 * The external oracle runs these exact sources at its default recursion limit. */
export const codecCallbackRecursionCases = [
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
decoder = codecs.getincrementaldecoder('${encoding}')('recursive-lifecycle')
def handler(error):
    events.append((error.object, error.start, error.end, error.reason, decoder.getstate()))
    return (decoder.decode(b'${valid}', True), error.end)
codecs.register_error('recursive-lifecycle', handler)
for attempt in range(2):
    events.clear()
    decoder.errors = 'recursive-lifecycle'
    print('prefix', repr(decoder.decode(b'${prefix}')), decoder.getstate())
    try:
        decoder.decode(b'${tail}', True)
    except RecursionError as error:
        print('failure', type(error).__name__, error.args, error.__cause__, error.__context__, error.__suppress_context__)
        traceback = error.__traceback__
        frames = []
        while traceback is not None:
            frames.append((traceback.tb_frame.f_code.co_name, traceback.tb_lineno, traceback.tb_lasti))
            traceback = traceback.tb_next
        print('frames', frames)
    print('events', events)
    print('state', decoder.getstate())
    decoder.reset()
    decoder.errors = 'strict'
    print('reset', repr(decoder.decode(b'${valid}', True)), decoder.getstate())
`,
}));
