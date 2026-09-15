/** Live registry mutation programs replayed unchanged by the external oracle. */
export const codecSearchPathMatrixCases = [
  "codecs.unregister(a)",
  "codecs.unregister(b)",
  "codecs.unregister(c)",
  "codecs.unregister(unregistered)",
  "codecs.register(c)",
  "codecs.unregister(a)\n        codecs.register(a)",
  "codecs.unregister(a)\n        codecs.unregister(b)\n        codecs.unregister(c)",
].flatMap((action, actionIndex) => ["a, b, c", "a, a, b", "b, a, c, a"].flatMap((path, pathIndex) => [
  "return None", "return info", "return []", "raise failure",
].map((outcome, outcomeIndex) => ({
  name: `live path ${pathIndex}, mutation ${actionIndex}, outcome ${outcomeIndex}`,
  source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
info = (None, None, None, None)
failure = ValueError('search callback')
active = False
class Search:
    def __init__(self, name):
        self.name = name
    def __eq__(self, other):
        raise AssertionError('search identity used equality')
    def __hash__(self):
        raise AssertionError('search identity used hashing')
    def __call__(self, name):
        global active
        events.append((self.name, name))
        if self is not a or active:
            return None
        active = True
        ${action}
        ${outcome}
a = Search('a')
b = Search('b')
c = Search('c')
unregistered = Search('absent')
for search in (${path}):
    codecs.register(search)
for spelling in ('Matrix-Codec', 'MATRIX CODEC', 'matrix_codec'):
    try:
        result = codecs.lookup(spelling)
        print('result', result is info)
    except Exception as error:
        print(type(error).__name__, error.args, error is failure)
    print(events)
    events.clear()
for search in (a, b, c):
    codecs.unregister(search)
try:
    print('after removal', codecs.lookup('matrix_codec') is info)
except Exception as error:
    print('after removal', type(error).__name__, error.args)
print(events)
`,
}))));
