/** Public guest programs shared unchanged with the external CPython oracle. */
export const coreCodecResultCases = [
  ...["ascii","latin_1","utf_8"].map(codec=>{
    const entries=["(b'', '')"];
    for(let point=0;point<(codec==="ascii"?128:256);point++){
      const bytes=codec==="utf_8"?new TextEncoder().encode(String.fromCodePoint(point)):[point];
      entries.push(`(b'${[...bytes].map(byte=>`\\x${byte.toString(16).padStart(2,"0")}`).join("")}', '\\u${point.toString(16).padStart(4,"0")}')`);
    }
    return {name:`${codec} full Latin-1 result identities`,source:`
from _codecs import ${codec}_decode as decode
class Buffer(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes')
    def __len__(self):
        raise AssertionError('virtual length')
for data, reference in [${entries.join(",")}]:
    for source in (data, Buffer(data)):
        result = decode(source)
        assert type(result) is tuple and type(result[0]) is str
        assert result == (reference, len(data))
        assert result[0] is reference, ('singleton', reference)
        assert decode(source)[0] is result[0]
first = decode(b'AB')
second = decode(b'AB')
assert first == second == ('AB', 2)
assert first is not second and first[0] is not second[0]
`};
  }),
  ...["ascii","utf_8"].map(codec=>({name:`${codec} recovery result identities`,source:`
from _codecs import ${codec}_decode as decode, register_error
seen = []
class Text(str):
    def __str__(self):
        raise AssertionError('virtual text')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual tuple')
class Position:
    def __index__(self):
        seen[-1].object = b'XY'
        return -1
def handler(error):
    seen.append(error)
    return Pair((Text(''), Position()))
register_error('core_result_identity', handler)
reference = 'Y'
result = decode(b'\\xffAB', 'core_result_identity')
assert result == (reference, ${codec==="ascii"?3:2})
assert result[0] is reference
assert seen[0].object == b'XY'
assert seen[0].args[1] == b'\\xffAB'
assert seen[0].args[2:4] == (0, 1)
def handler(error):
    return (Text('é'), error.end)
register_error('core_result_identity', handler)
reference = 'é'
assert decode(b'\\xff', 'core_result_identity')[0] is reference
def handler(error):
    return (Text('Ā'), error.end)
register_error('core_result_identity', handler)
first = decode(b'\\xff', 'core_result_identity')[0]
second = decode(b'\\xff', 'core_result_identity')[0]
assert first == second == 'Ā'
assert type(first) is str and first is not second
`}))
];
