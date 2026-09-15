import reference from "./runtime/__snapshots__/codec-private-names-3.14.7.json" with {type: "json"};

const batches = Array.from({length: Math.ceil(reference.rows.length / 32)}, (_, index) =>
  reference.rows.slice(index * 32, (index + 1) * 32));

/** Programs replayed unchanged by the public session and external oracle. */
export const codecPrivateNameCases = batches.map((rows, index) => ({index, source: `
import codecs
mapping = {point: point for point in range(128)}
for point, replacement, position in ${JSON.stringify(rows.map(row => [row.point, row.replacement, row.position]))}:
    source = chr(point)
    error = UnicodeEncodeError('ascii', source, 0, 1, 'ordinal not in range(128)')
    assert codecs.namereplace_errors(error) == (replacement, position), point
    expected = replacement.encode('ascii')
    for encoding in ('ascii', 'latin-1', 'cp1252'):
        assert source.encode(encoding, 'namereplace') == expected, (point, encoding)
        assert bytes(source, encoding, 'namereplace') == expected, (point, encoding)
    assert codecs.charmap_encode(source, 'namereplace', mapping) == (expected, 1), point
`}));
