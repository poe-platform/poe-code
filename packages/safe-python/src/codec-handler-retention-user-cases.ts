/** Whole guest programs shared by unit checks and the external pinned oracle. */
export const codecHandlerRetentionUserCases = [
  {encoding: "ascii", data: "b'\\xffA\\xffZ'"},
  {encoding: "cp1252", data: "b'\\x81A\\x81Z'"},
  {encoding: "utf-8", data: "b'\\xffA\\xffZ'"},
  {encoding: "utf-8-sig", data: "b'\\xef\\xbb\\xbf\\xffA\\xffZ'"},
  {encoding: "utf-16-le", data: "b'\\x00\\xdcA\\x00\\x00\\xdcZ\\x00'"},
  {encoding: "utf-16-be", data: "b'\\xdc\\x00\\x00A\\xdc\\x00\\x00Z'"},
  {encoding: "utf-32-le", data: "b'\\x00\\x00\\x11\\x00A\\x00\\x00\\x00\\x00\\x00\\x11\\x00Z\\x00\\x00\\x00'"},
  {encoding: "utf-32-be", data: "b'\\x00\\x11\\x00\\x00\\x00\\x00\\x00A\\x00\\x11\\x00\\x00\\x00\\x00\\x00Z'"},
].flatMap(({encoding, data}) => ["encode", "decode"].flatMap(operation =>
  ["unregister", "replace"].map(action => ({
    name: `${encoding} ${operation} retains handler after ${action}`,
    source: `import codecs
import _codecs
events = []
codec = codecs.getincremental${operation === "encode" ? "encoder" : "decoder"}('${encoding}')('retained-user')
class Position:
    def __init__(self, error):
        self.error = error
    def __index__(self):
        events.append(('index', self.error.end, len(self.error.object)))
        assert input() == 'continue'
        return self.error.end - len(self.error.object)
def replacement(error):
    events.append(('replacement', error.start, error.end))
    return ('N', Position(error))
def handler(error):
    events.append(('original', error.start, error.end))
    ${action === "unregister" ? "events.append(('removed', _codecs._unregister_error('retained-user')))" : "codecs.register_error('retained-user', replacement)"}
    return ('R', Position(error))
codecs.register_error('retained-user', handler)
data = ${operation === "encode" ? "'\\ud800A\\ud800Z'" : data}
for attempt in (1, 2):
    try:
        print('result', attempt, codec.${operation}(data, True))
    except LookupError as error:
        print('failure', attempt, type(error).__name__, error.args)
    print('state', codec.getstate())
print('events', events)
codec.reset()
codec.errors = 'replace'
print('reset', codec.getstate(), codec.${operation}(data, True))
`,
  })),
));
