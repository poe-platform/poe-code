/** Replay unchanged on the pinned external oracle and the public interpreter. */
export const codecResumeValidationMatrixCases = [
  "utf-8", "ascii", "latin-1", "utf-16", "utf-32",
  "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"
].flatMap(encoding => (["encode", "decode"] as const).map(operation => ({
  name: `${encoding} ${operation}`,
  source: `import codecs
class Position:
    def __index__(self):
        events.append('index')
        return position
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual indexing')
def handler(error):
    events.append((error.start, error.end, error.reason))
    if len(events) > 2:
        raise RuntimeError('repeated')
    return Pair((replacement, Position()))
codecs.register_error('resume-audit', handler)
for encoding in ('${encoding}',):
    for operation in ('${operation}',):
        for replacement in ('?', b'?', None):
            for position in (-4, -3, -1, 0, 1, 3, 4, 2**63, -2**63-1):
                events = []
                value = 'A\\ud800B' if operation == 'encode' else b'A\\xffB'
                try:
                    result = codecs.encode(value, encoding, 'resume-audit') if operation == 'encode' else codecs.decode(value, encoding, 'resume-audit')
                    outcome = ('ok', result)
                except Exception as error:
                    outcome = (type(error).__name__, error.args, getattr(error, '__notes__', None))
                print(encoding, operation, replacement, position, events, outcome)
`
})));
