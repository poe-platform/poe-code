/** Sources shared unchanged by the external oracle and interpreter tests. */
export const codecResultDiagnosticByteCases = [
  "b'\\x80' * 401",
  "b'a' * 399 + b'\\xff'",
  "b'a' * 399 + b'\\xe2'",
  "b'a' * 398 + b'\\xe2'",
  "b'a' * 399 + b'\\xe2\\x82\\xac'",
].flatMap(raw => ["encode", "decode", "escape"].map(operation => ({
  name: `${operation}: ${raw}`,
  source: String.raw`
import codecs, _codecs
name = '\ud800'
def recover(error):
    return (${raw}, error.end)
codecs.register_error('strict', recover)
def convert(value, errors='strict'):
    return (None, 1)
def search(name):
    return codecs.CodecInfo(name=name, encode=convert, decode=convert)
codecs.register(search)
try:
    ${operation === "encode" ? "'x'.encode(name)" : operation === "decode" ? "b'x'.decode(name)" : "_codecs.escape_decode(b'\\\\x', name)"}
except ${operation === "escape" ? "ValueError" : "TypeError"} as error:
    print(str(error))
else:
    assert False
`
})));
