/** Identical public programs run by PythonSession and the external oracle. */
export const codecHandlerFieldPrecedenceCases = ["encode", "decode", "translate"].flatMap(mode =>
  ["missing", "none", "integer", "surrogate", "unknown", "subtype"].map(encoding => ({
    name: `${mode}: ${encoding} encoding with mutated object`,
    source: String.raw`
import codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string conversion')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes conversion')
for policy in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
    for mutation in ('original', 'missing', 'none', 'wrong', 'subtype', 'empty'):
        original = ${mode === "translate" ? "UnicodeTranslateError('\\ud800', 0, 1, 'reason')" : mode === "encode" ? "UnicodeEncodeError('utf-8', '\\ud800', 0, 1, 'reason')" : "UnicodeDecodeError('utf-8', b'\\xed\\xa0\\x80', 0, 3, 'reason')"}
        ${encoding === "missing" ? (mode === "translate" ? "pass" : "del original.encoding") : `original.encoding = ${encoding === "none" ? "None" : encoding === "integer" ? "42" : encoding === "surrogate" ? "Text('\\ud800')" : encoding === "unknown" ? "'unknown'" : "Text('utf-8')"}`}
        if mutation == 'missing':
            del original.object
        elif mutation == 'none':
            original.object = None
        elif mutation == 'wrong':
            original.object = ${mode === "decode" ? "'bad'" : "b'bad'"}
        elif mutation == 'subtype':
            original.object = ${mode === "decode" ? "Data(b'\\xed\\xa0\\x80')" : "Text('\\ud800')"}
        elif mutation == 'empty':
            original.object = ${mode === "decode" ? "b''" : "''"}
        try:
            result = codecs.lookup_error(policy)(original)
        except BaseException as caught:
            print(policy, mutation, type(caught).__name__, repr(caught.args), caught is original)
        else:
            print(policy, mutation, repr(result), type(result[0]).__name__, type(result[1]).__name__)
`
  }))
);
