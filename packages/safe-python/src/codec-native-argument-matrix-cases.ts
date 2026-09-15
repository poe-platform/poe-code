/** Identical guest programs run by PythonSession and the pinned external oracle. */
export const codecNativeArgumentMatrixCases = [
  "utf_8", "utf_7", "ascii", "latin_1", "unicode_escape", "raw_unicode_escape",
  "charmap", "utf_16", "utf_16_le", "utf_16_be", "utf_32", "utf_32_le",
  "utf_32_be", "escape"
].flatMap(codec => ["encode", "decode"].map(operation => ({
  name: `${codec}_${operation}`,
  source: `import _codecs
f = _codecs.${codec}_${operation}
for data in ['', 'A', 'é', '\\ud800', '\\udc80', '😀', b'', b'A', b'\\xff', None, 1, True, [], (), NotImplemented]:
    for errors in [None, '', 'strict', 'ignore', 'replace', 'surrogatepass', 'surrogateescape', 'no-such-handler', 1, False, b'']:
        try:
            result = f(data, errors)
            print(repr(data), repr(errors), 'ok', type(result).__name__, type(result[0]).__name__, type(result[1]).__name__, repr(result))
        except Exception as error:
            print(repr(data), repr(errors), type(error).__name__, repr(error.args))
`
}))).concat(["utf_16_encode", "utf_32_encode", "utf_16_ex_decode", "utf_32_ex_decode"].map(name => ({
  name: `${name}_order`,
  source: `import _codecs
f = _codecs.${name}
events = []
class Order:
    def __index__(self):
        events.append('index')
        return current
class Final:
    def __bool__(self):
        events.append('final')
        return True
for current in [-2**100, -2**63-1, -2**63, -2**31-1, -2**31, -1, 0, 1, 2**31-1, 2**31, 2**63-1, 2**63, 2**100, None, 1.5, True]:
    events.clear()
    try:
        result = f(${name.endsWith("encode") ? "'A', None, Order()" : "b'\\xff\\xfe\\x00\\x00', None, Order(), Final()"})
        print(current, 'ok', repr(result), events)
    except Exception as error:
        print(current, type(error).__name__, repr(error.args), events)
`
})));
