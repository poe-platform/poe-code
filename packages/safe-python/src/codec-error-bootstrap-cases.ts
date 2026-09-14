/** Unchanged public programs for the interpreter and pinned external oracle. */
export const codecErrorBootstrapCases = [
  "strict", "ignore", "replace", "xmlcharrefreplace", "backslashreplace", "namereplace"
].map(name => ({
  name: `${name}: replacement before importing codecs retains the published builtin`,
  source: `import _codecs
original = _codecs.lookup_error('${name}')
events = []
def replacement(error):
    events.append(error)
    return ('replacement', error.end)
_codecs.register_error('${name}', replacement)
import codecs
assert codecs.${name}_errors is original
assert codecs.lookup_error('${name}') is replacement
assert codecs.lookup_error('${name}') is _codecs.lookup_error('${name}')
failure = UnicodeEncodeError('ascii', 'é', 0, 1, 'unencodable')
assert codecs.lookup_error('${name}')(failure) == ('replacement', 1)
assert events == [failure]
_codecs.register_error('${name}', original)
assert codecs.lookup_error('${name}') is original
assert codecs.${name}_errors is original
`
}));
