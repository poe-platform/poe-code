/** Unchanged programs for the public interpreter and CPython 3.14.7 oracle. */
export const codecSearchInterningCases = [
  {
    name: "normalized search names share identifier literal identity",
    source: `
import _codecs
literal = 'codec_intern_identity'
seen = []
codec = (None, None, None, None)
def search(name):
    seen.append(name)
    assert name is literal, 'search argument is not the interned literal'
    return codec
_codecs.register(search)
assert _codecs.lookup('CODEC--INTERN IDENTITY') is codec
_codecs.unregister(search)
_codecs.register(search)
assert _codecs.lookup(literal) is codec
assert seen[0] is seen[1]
`
  },
  {
    name: "interning leaves dynamically constructed equal strings distinct",
    source: `
import _codecs
literal = 'codec_dynamic_identity'
dynamic = ''.join(['codec_dynamic_', 'identity'])
assert dynamic == literal and dynamic is not literal
def search(name):
    assert name is literal
    assert name is not dynamic
    return (None, None, None, None)
_codecs.register(search)
_codecs.lookup(dynamic)
`
  },
  {
    name: "dotted names are interned by lookup but not by literal compilation",
    source: `
import _codecs
literal = 'codec.intern.identity'
seen = []
def search(name):
    assert name == literal and name is not literal
    seen.append(name)
    return None
_codecs.register(search)
for spelling in (literal, 'CODEC.INTERN.IDENTITY'):
    try:
        _codecs.lookup(spelling)
    except LookupError:
        pass
assert len(seen) == 2 and seen[0] is seen[1]
`
  }
];
