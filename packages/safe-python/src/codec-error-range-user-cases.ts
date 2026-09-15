/** Unchanged programs for the guest interpreter and pinned external oracle. */
export const codecErrorRangeUserCases = [
  "ignore", "replace", "backslashreplace", "xmlcharrefreplace",
  "namereplace", "surrogatepass", "surrogateescape"
].flatMap(handler => [
  {kind: "encode", constructor: "UnicodeEncodeError", objects: "('', 'A', '\\ud800', '\\udc80', '🐍')"},
  {kind: "decode", constructor: "UnicodeDecodeError", objects: "(b'', b'A', b'\\xed\\xa0\\x80', b'\\x80\\xffA', b'\\xf0\\x9f\\x90\\x8d')"},
  {kind: "translate", constructor: "UnicodeTranslateError", objects: "('', 'A', '\\ud800', '\\udc80', '🐍')"}
].map(({kind, constructor, objects}) => ({
  name: `${handler}: ${kind}`,
  source: `import codecs
assert input() == 'ready'
handler = codecs.lookup_error('${handler}')
for original in ${objects}:
    for start in (-4, 0, 1, 4):
        for end in (-4, 0, 1, 4):
            error = ${constructor}(${kind === "translate" ? "" : "'utf-8', "}original, start, end, 'range audit')
            arguments = error.args
            try:
                result = handler(error)
            except BaseException as caught:
                print(repr(original), start, end, type(caught).__name__, repr(caught.args), caught is error)
            else:
                print(repr(original), start, end, repr(result), type(result).__name__, type(result[0]).__name__, type(result[1]).__name__)
            assert error.args is arguments
            assert error.object is original
            assert (error.start, error.end, error.reason) == (start, end, 'range audit')
`
})));
