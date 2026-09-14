/** Public programs replayed unchanged by the interpreter and pinned oracle. */
export const codecRecoveryIndexBoundaryCases = [
  "ascii_encode", "latin_1_encode", "utf_8_encode", "ascii_decode", "utf_8_decode"
].flatMap(operation => ["text", "bytes", "invalid", "tuple-subtype", "mutated", "index-failure"].map(shape => ({
  name: `${operation}: ${shape} index boundaries`,
  source: String.raw`
import codecs
operation = getattr(codecs, '${operation}')
source = ${operation.endsWith("encode") ? "'A\\ud800Z'" : "b'A\\xffZ'"}
class Text(str):
    def __str__(self):
        raise AssertionError('text conversion')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('bytes conversion')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('tuple indexing')
    def __iter__(self):
        raise AssertionError('tuple iteration')
class Position:
    def __index__(self):
        events.append('index')
        ${shape === "mutated" ? `cached[0].object = ${operation.endsWith("decode") ? "Data(b'XY')" : "Text('XY')"}` : shape === "index-failure" ? "raise failure" : "pass"}
        return position
failure = ValueError('index failed')
for position in (-9223372036854775809, -9223372036854775808, -4, -3, -2, -1, 0, 1, 2, 3, 4, 9223372036854775807, 9223372036854775808):
    events = []
    cached = []
    def handler(error):
        events.append(('handler', error.start, error.end))
        if cached:
            assert cached[0] is error
            return ('!', len(error.object))
        cached.append(error)
        result = (${shape === "bytes" ? "Data(b'?')" : shape === "invalid" ? "None" : "Text('?')"}, Position())
        return ${shape === "tuple-subtype" ? "Pair(result)" : "result"}
    codecs.register_error('index_boundary', handler)
    try:
        result = operation(source, 'index_boundary')
    except BaseException as error:
        print(position, type(error).__name__, repr(error.args), error is failure, events)
    else:
        print(position, repr(result), type(result).__name__, type(result[0]).__name__, events)
`
})));
