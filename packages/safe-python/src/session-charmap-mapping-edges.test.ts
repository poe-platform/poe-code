import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

// Guest programs also run unchanged against the pinned external CPython oracle.
// The unit suite executes only the real sandbox interpreter.
const cases = [
  String.raw`
import _codecs
events = []
class Mapping:
    def __getitem__(self, key):
        events.append(key)
        raise LookupError('missing')
def recover(error):
    return (b'!' if isinstance(error, UnicodeEncodeError) else '!', error.end)
_codecs.register_error('edge', recover)
assert _codecs.charmap_encode('AB', 'edge', Mapping()) == (b'!', 2)
assert events == [65, 66]
events.clear()
assert _codecs.charmap_decode(b'AB', 'edge', Mapping()) == ('!!', 2)
assert events == [65, 66]
`,
  String.raw`
import _codecs
events = []
class Mapping(str):
    def __getitem__(self, key):
        events.append(key)
        return 'x'
assert _codecs.charmap_decode(b'AB', 'strict', Mapping('')) == ('xx', 2)
assert events == [65, 66]
for value in [65534, '\ufffe']:
    assert _codecs.charmap_decode(b'A', 'replace', {65: value}) == ('\ufffd', 1)
assert _codecs.charmap_decode(b'A', 'strict', {65: '\ufffeA'}) == ('\ufffeA', 1)
assert _codecs.charmap_decode(b'A', 'strict', {65: True}) == ('\x01', 1)
`,
  String.raw`
import _codecs
events = []
class Mapping:
    def __getitem__(self, key):
        events.append(key)
        return None if key == 65 else 'invalid'
for policy in ['strict', 'ignore', 'replace']:
    events.clear()
    try:
        _codecs.charmap_encode('AB', policy, Mapping())
    except TypeError as error:
        assert error.args == ('character mapping must return integer, bytes or None, not str',)
    else:
        assert False
    assert events == [65, 66]
`,
  String.raw`
import _codecs
events = []
mapping = {}
class Position:
    def __index__(self):
        events.append('index')
        mapping[66] = 'changed'
        return -1
def recover(error):
    events.append((error.start, error.end))
    return ('!', Position())
_codecs.register_error('edge', recover)
assert _codecs.charmap_decode(b'AB', 'edge', mapping) == ('!changed', 2)
assert events == [(0, 1), 'index']
`,
  String.raw`
import _codecs
events = []
class Mapping:
    def __getitem__(self, key):
        events.append(key)
        return None if key == 65 else 66
class Position:
    def __index__(self):
        events.append('index')
        return -1
def recover(error):
    events.append((error.start, error.end))
    return (b'!', Position())
_codecs.register_error('edge', recover)
assert _codecs.charmap_encode('AB', 'edge', Mapping()) == (b'!B', 2)
assert events == [65, 66, (0, 1), 'index', 66]
`,
];

it.each(cases.map((source,index)=>({source,index})))("matches pinned charmap mapping edge $index",({source})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const message=session.eval("str(failure)");
    if(message.status==="ok")detail=String(message.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});

it.each(["encode","decode"])("cancels charmap %s during resume-position conversion",operation=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return "value\n";}},output:{write(){},flush(){}}});
  const result=session.exec(`
import _codecs
class Position:
    def __index__(self):
        input()
        raise AssertionError('resumed index')
def recover(error):
    return (${operation==="encode"?"b'!'":"'!'"}, Position())
_codecs.register_error('edge', recover)
try:
    _codecs.charmap_${operation}(${operation==="encode"?"'a'":"b'a'"}, 'edge', {})
except BaseException:
    input()
    raise AssertionError('caught cancellation')
input()
raise AssertionError('resumed decoder')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
});
