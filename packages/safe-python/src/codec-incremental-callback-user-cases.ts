/** Unchanged public guest programs for the pinned external differential oracle. */
export const codecIncrementalCallbackUserCases = [
  {encoding: "ascii", data: "b'\\xffA'", valid: "b'B'"},
  {encoding: "cp1252", data: "b'\\x81A'", valid: "b'B'"},
  {encoding: "utf-8", data: "b'\\xed\\xa0\\x80A'", valid: "b'B'"},
  {encoding: "utf-8-sig", data: "b'\\xef\\xbb\\xbf\\xed\\xa0\\x80A'", valid: "b'B'"},
  {encoding: "utf-16-le", data: "b'\\x00\\xd8A\\x00'", valid: "b'B\\x00'"},
  {encoding: "utf-16-be", data: "b'\\xd8\\x00\\x00A'", valid: "b'\\x00B'"},
  {encoding: "utf-32-le", data: "b'\\x00\\x00\\x11\\x00A\\x00\\x00\\x00'", valid: "b'B\\x00\\x00\\x00'"},
  {encoding: "utf-32-be", data: "b'\\x00\\x11\\x00\\x00\\x00\\x00\\x00A'", valid: "b'\\x00\\x00\\x00B'"},
].flatMap(({encoding, data, valid}) =>
  ["reenter", "reenter_once", "reset", "restore", "replace_handler"].flatMap(action =>
    ["return", "raise", "overflow"].map(outcome => ({
      name: `${encoding}; ${action}; ${outcome}`,
      source: `import codecs
events = []
failure = ValueError('callback failure')
active = False
decoder = codecs.getincrementaldecoder('${encoding}')('callback-audit')
data = ${data}
valid = ${valid}
def replacement(error):
    events.append(('replacement', error.start, error.end))
    return ('N', error.end)
class Position:
    def __init__(self, position):
        self.position = position
    def __index__(self):
        events.append(('index', self.position))
        return self.position
def handler(error):
    global active
    events.append(('handler', error.object, error.start, error.end, error.reason, decoder.getstate()))
    ${action === "reenter_once" ? "if active:\n        return ('N', error.end)\n    active = True\n    events.append(('nested', decoder.decode(valid, True), decoder.getstate()))\n    active = False" : action === "reenter" ? "events.append(('nested', decoder.decode(valid, True), decoder.getstate()))" : action === "reset" ? "decoder.reset()\n    events.append(('reset', decoder.getstate()))" : action === "restore" ? "decoder.setstate((b'', 0))\n    events.append(('restore', decoder.getstate()))" : "codecs.register_error('callback-audit', replacement)\n    events.append(('registered', codecs.lookup_error('callback-audit') is replacement))"}
    ${outcome === "raise" ? "raise failure" : outcome === "overflow" ? "return ('R', Position(1 << 100))" : "return ('R', Position(error.end - len(error.object)))"}
codecs.register_error('callback-audit', handler)
split = ${encoding === "ascii" || encoding === "cp1252" ? 0 : 1}
print('prefix', repr(decoder.decode(data[:split])), decoder.getstate())
try:
    print('result', repr(decoder.decode(data[split:], True)))
except BaseException as caught:
    print('failure', type(caught).__name__, caught.args, caught is failure)
print('events', events)
print('state', decoder.getstate())
decoder.reset()
decoder.errors = 'strict'
print('after reset', repr(decoder.decode(valid, True)), decoder.getstate())
`,
    })),
  ),
);
