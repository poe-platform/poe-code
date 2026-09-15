import {singleByteTables} from "./runtime/single-byte-tables.js";

/** Run these programs unchanged in PythonSession and the pinned external oracle. */
export const codecEncodedAllocationCases = [
  {name:"UTF-7 native direct characters",source:String.raw`
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
for point in range(128):
    for source in (chr(point), Text(chr(point))):
        first = _codecs.utf_7_encode(source)
        second = _codecs.utf_7_encode(source)
        assert first == second
        assert type(first) is tuple and type(first[0]) is bytes
        assert first[0] is not second[0], point
empty = b''
assert _codecs.utf_7_encode('')[0] is empty
`},
  {name:"mapped charmap native allocation and empty recovery",source:String.raw`
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
table = ''.join(chr(point) for point in range(256))
for mapping in ({point: point for point in range(256)}, {point: bytes([point]) for point in range(256)}, _codecs.charmap_build(table)):
    for point in range(256):
        reference = bytes([point])
        for source in (chr(point), Text(chr(point))):
            first = _codecs.charmap_encode(source, 'strict', mapping)
            second = _codecs.charmap_encode(source, 'strict', mapping)
            assert first == second == (reference, 1)
            assert type(first[0]) is bytes
            assert first[0] is not second[0] and first[0] is not reference, point
empty = b''
for source, errors, mapping in [('', 'strict', {}), ('A', 'ignore', {}), ('A', 'strict', {65: b''})]:
    assert _codecs.charmap_encode(source, errors, mapping)[0] is empty
replacement = b'?'
_codecs.register_error('allocation_recovery', lambda error: (replacement, error.end))
first = _codecs.charmap_encode('A', 'allocation_recovery', {})[0]
second = _codecs.charmap_encode('A', 'allocation_recovery', {})[0]
assert first == second == replacement
assert first is not second and first is not replacement
for point in range(256):
    reference = bytes([point])
    assert _codecs.charmap_encode(chr(point))[0] is reference
`},
  {name:"preserved core and raw escape singleton allocation",source:String.raw`
import _codecs
empty = b''
for name, limit in [('ascii', 128), ('latin_1', 256), ('utf_8', 128), ('raw_unicode_escape', 256)]:
    encode = getattr(_codecs, name + '_encode')
    assert encode('')[0] is empty
    assert ''.encode(name) is empty
    for point in range(limit):
        reference = bytes([point])
        source = chr(point)
        assert encode(source)[0] is reference, (name, point)
        assert source.encode(name) is reference, (name, point)
        assert bytes(source, name) is reference, (name, point)
`},
  ...[
    ["utf_7","utf7","u7","unicode_1_1_utf_7"],
    ["unicode_escape"],
    ...singleByteTables.map(table=>[table.name])
  ].map(encodings=>({name:`text allocation: ${encodings[0]}`,source:`
for encoding in ${JSON.stringify(encodings)}:
    for source in ('', 'A'):
        first = source.encode(encoding)
        second = source.encode(encoding)
        constructed = bytes(source, encoding)
        assert first == second == constructed
        assert type(first) is bytes and type(constructed) is bytes
        if source:
            assert first is not second, encoding
            assert first is not constructed, encoding
        else:
            assert first is second is constructed, encoding
`}))
];
