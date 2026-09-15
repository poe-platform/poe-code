/** Execute unchanged in the public interpreter and pinned external oracle. */
export const codecHandlerResultIdentityCases = [
  {
    name: "replace allocates nonempty encoder replacements independently of Latin-1 singletons",
    source: `
import _codecs
handler = _codecs.lookup_error('replace')
singleton = '?'
empty = ''
for text in ('', 'A', 'AB', '\\ud800'):
    for start, end in ((0, 0), (0, 1), (0, len(text)), (1, 0)):
        error = UnicodeEncodeError('ascii', text, start, end, 'reason')
        first = handler(error)
        second = handler(error)
        assert type(first) is tuple and type(first[0]) is str
        assert first == second and first is not second
        if first[0]:
            assert first[0] is not second[0], (text, start, end)
            assert first[0] is not singleton
        else:
            assert first[0] is empty and second[0] is empty
`
  },
  {
    name: "surrogateescape allocates every nonempty byte replacement",
    source: `
import _codecs
handler = _codecs.lookup_error('surrogateescape')
for point in range(128, 256):
    error = UnicodeEncodeError('ascii', chr(0xdc00 + point), 0, 1, 'reason')
    singleton = bytes([point])
    first = handler(error)
    second = handler(error)
    assert type(first) is tuple and type(first[0]) is bytes
    assert first == (singleton, 1) and second == first
    assert first is not second
    assert first[0] is not second[0], point
    assert first[0] is not singleton, point
`
  },
  {
    name: "surrogate handlers retain the empty bytes singleton",
    source: `
import _codecs
empty = b''
for name in ('surrogateescape', 'surrogatepass'):
    handler = _codecs.lookup_error(name)
    for text, start, end in (('', 0, 0), ('\\udc80\\udc81', 1, 0)):
        error = UnicodeEncodeError('utf-8', text, start, end, 'reason')
        first = handler(error)
        second = handler(error)
        assert first[0] is empty and second[0] is empty
        assert first == second and first is not second
`
  }
] as const;
