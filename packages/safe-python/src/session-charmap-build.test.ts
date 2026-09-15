import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const cases=[
  `import _codecs
for count, size in [(253, 32703), (254, 32831)]:
    table = '\\x00' + ''.join(chr(i * 128 + 1) for i in range(count))
    mapping = _codecs.charmap_build(table)
    assert mapping.size() == size
    assert _codecs.charmap_encode(table, 'strict', mapping) == (bytes(range(count + 1)), count + 1)
table = '\\x00' + ''.join(chr(i * 128 + 1) for i in range(255))
mapping = _codecs.charmap_build(table)
assert type(mapping) is dict and len(mapping) == 256
assert _codecs.charmap_encode(table, 'strict', mapping) == (bytes(range(256)), 256)
mapping = _codecs.charmap_build('\\x00a' + '\\ufffe' * 254 + '\\U00010000')
assert mapping.size() == 207
assert _codecs.charmap_encode('a', 'strict', mapping) == (b'\\x01', 1)
`,
  `import _codecs
assert _codecs.charmap_build('aba') == {97: 2, 98: 1}
assert _codecs.charmap_build('a' * 300) == {97: 255}
assert _codecs.charmap_build('\\x00\\U00010000') == {0: 0, 65536: 1}
assert _codecs.charmap_build('\\x00a\\x00') == {0: 2, 97: 1}
assert _codecs.charmap_build('a\\ufffe') == {97: 0, 65534: 1}
`,
  `import _codecs
for table, size in [('\\x00', 63), ('\\x00a', 207), ('\\x00\\ufffe', 63), ('\\x00\\uffff', 207), (''.join(map(chr, range(256))), 335)]:
    mapping = _codecs.charmap_build(table)
    assert type(mapping).__name__ == 'EncodingMap'
    assert type(mapping).__module__ == 'builtins'
    assert mapping.size() == size
    assert _codecs.charmap_encode('\\x00', 'strict', mapping) == (b'\\x00', 1)
mapping = _codecs.charmap_build('\\x00aba?')
assert _codecs.charmap_encode('aba', 'strict', mapping) == (b'\\x03\\x02\\x03', 3)
assert _codecs.charmap_encode('z', 'replace', mapping) == (b'\\x04', 1)
assert _codecs.charmap_encode('z', 'ignore', mapping) == (b'', 1)
def recover(error):
    assert (error.encoding, error.object, error.start, error.end, error.reason) == ('charmap', 'z', 0, 1, 'character maps to <undefined>')
    return ('ab', error.end)
_codecs.register_error('build_recovery', recover)
assert _codecs.charmap_encode('z', 'build_recovery', mapping) == (b'\\x03\\x02', 1)
`,
  `import _codecs
class Text(str):
    def __len__(self):
        raise AssertionError('virtual length')
    def __getitem__(self, key):
        raise AssertionError('virtual item')
assert _codecs.charmap_build(Text('aba')) == {97: 2, 98: 1}
assert _codecs.charmap_build(Text('\\x00a')).size() == 207
for args, message in [((), '_codecs.charmap_build() takes exactly one argument (0 given)'), ((None,), 'charmap_build() argument must be str, not None'), (('',), 'bad argument type for built-in operation'), (('a','b'), '_codecs.charmap_build() takes exactly one argument (2 given)')]:
    try:
        _codecs.charmap_build(*args)
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
try:
    _codecs.charmap_build(map='a')
except TypeError as error:
    assert error.args == ('_codecs.charmap_build() takes no keyword arguments',)
else:
    assert False
`,
  `import _codecs
mapping = _codecs.charmap_build('\\x00a')
Map = type(mapping)
assert mapping.size.__self__ is mapping
assert Map.size.__objclass__ is Map
assert Map.size.__doc__ == 'Return the size (in bytes) of this object.'
assert Map.size.__text_signature__ == '($self, /)'
for operation, message in [(lambda: Map(), "cannot create 'EncodingMap' instances"), (lambda: mapping.size(1), 'EncodingMap.size() takes no arguments (1 given)'), (lambda: mapping.size(value=1), 'EncodingMap.size() takes no keyword arguments')]:
    try:
        operation()
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
try:
    class Derived(Map):
        pass
except TypeError as error:
    assert error.args == ("type 'EncodingMap' is not an acceptable base type",)
else:
    assert False
try:
    mapping[0]
except TypeError as error:
    assert error.args == ("'EncodingMap' object is not subscriptable",)
else:
    assert False
`
];

it.each(cases)("executes public charmap_build contract %#",source=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    detail=session.eval("str(failure)");
    if(detail&&typeof detail==="object"&&"value" in detail)detail=(detail.value as {primitive:unknown}).primitive;
  }
  expect(result.status,JSON.stringify(detail)).toBe("ok");
});
