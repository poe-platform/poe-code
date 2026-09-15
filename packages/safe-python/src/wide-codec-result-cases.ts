/** Guest programs replayed unchanged against the pinned CPython oracle. */
export const wideCodecResultCases = [16,32].flatMap(width=>["","_le","_be","_ex"].map(suffix=>({
  name:`utf_${width}${suffix}_decode result identities`,
  source:`
from _codecs import utf_${width}${suffix}_decode as decode, utf_${width}${suffix==="_ex"?"":suffix}_encode as encode, register_error
for point in range(256):
    reference = chr(point)
    data = encode(reference)[0]
    first = decode(data)
    second = decode(data)
    assert type(first) is tuple and type(first[0]) is str
    assert type(first[1]) is int and first[1] == len(data)
    assert first[0] == reference
    assert first[0] is reference, ('singleton', point)
    assert second[0] is first[0]
    assert first is not second
for reference in ('', 'AB', '\\u0100', '\\U0001f600', '\\U0010ffff', '\\ud800'):
    data = encode(reference, 'surrogatepass')[0]
    first = decode(data, 'surrogatepass', ${suffix==="_ex"?"0, ":""}True)
    second = decode(data, 'surrogatepass', ${suffix==="_ex"?"0, ":""}True)
    assert first[0] == second[0] == reference
    assert (first[0] is second[0]) == (reference == '')
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
replacement = Text('é')
def handler(error):
    return (replacement, len(error.object))
register_error('wide_result_identity', handler)
data = encode('\\ud800', 'surrogatepass')[0]
for replacement in (Text(''), Text('é'), Text('Ā'), Text('AB')):
    first = decode(data, 'wide_result_identity', ${suffix==="_ex"?"0, ":""}True)[0]
    second = decode(data, 'wide_result_identity', ${suffix==="_ex"?"0, ":""}True)[0]
    assert type(first) is str and first == replacement
    assert first is not replacement
    assert (first is second) == (len(replacement) == 0 or replacement == 'é')
    if replacement == 'é':
        assert first is chr(233)
`
})));
