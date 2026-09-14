/** Public programs run unchanged by PythonSession and the pinned oracle. */
export const codecReentrantRecoveryCases = [
  "ascii_encode", "latin_1_encode", "utf_8_encode", "charmap_encode",
  "ascii_decode", "utf_8_decode", "charmap_decode"
].flatMap(operation => ["handler", "index", "index-failure"].map(phase => ({
  name: `${operation}: reentry during ${phase}`,
  source: String.raw`
import codecs
operation = codecs.${operation}
source = ${operation.endsWith("encode") ? "'\\ud800A\\ud800'" : "b'\\xffA\\xff'"}
events = []
saved = []
failure = ValueError('nested index failure')
class Text(str):
    def __str__(self):
        raise AssertionError('virtual text conversion')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes conversion')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual tuple indexing')
    def __len__(self):
        raise AssertionError('virtual tuple length')
def run():
    return operation(source, 'reentrant_recovery'${operation === "charmap_decode" ? ", {65: 'A', 66: 'B'}" : ""})
def replacement(error):
    assert not saved or error is not saved[0]
    events.append(('nested', error.start, error.end))
    return (Text('!'), error.end)
def reenter():
    codecs.register_error('reentrant_recovery', replacement)
    events.append(('result', run()))
class Position:
    def __index__(self):
        error = saved[0]
        events.append(('index', error.start, error.end))
        error.object = ${operation.endsWith("encode") ? "Text('changed')" : "Data(b'\\xffB\\xff')"}
        ${phase === "handler" ? "pass" : "reenter()"}
        ${phase === "index-failure" ? "raise failure" : "return error.end"}
def original(error):
    events.append(('outer', error.start, error.end))
    if not saved:
        saved.append(error)
        ${phase === "handler" ? "reenter()" : "pass"}
        return Pair((Text('?'), Position()))
    assert error is saved[0]
    return Pair((Text('?'), error.end))
codecs.register_error('reentrant_recovery', original)
try:
    print('outer result', run())
except ValueError as error:
    assert error is failure
    print('failure', type(error).__name__, error.args)
assert codecs.lookup_error('reentrant_recovery') is replacement
print(events)
error = saved[0]
print(error.args, error.encoding, repr(error.object), type(error.object).__name__, error.start, error.end, error.reason)
print('next result', run())
`
})));
