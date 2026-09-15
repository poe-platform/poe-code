import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const encodings=["utf-8-sig","utf-16","utf-16-le","utf-16-be","utf-32","utf-32-le","utf-32-be","cp1252"];
const policies=["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace","xmlcharrefreplace","namereplace","custom"];

function run(source:string){
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const message=session.eval("str(failure)");
    if(message.status==="ok")detail=String(message.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
}

// External CPython 3.14.7 / Unicode 16.0.0 oracle: wide Unicode consults
// every handler; UTF-8 and compiled charmaps retain different native policies.
it.each(encodings.flatMap(encoding=>policies.flatMap(policy=>[false,true].map(constructor=>({encoding,policy,constructor})))))(
  "honors $encoding/$policy registration (bytes constructor=$constructor)",({encoding,policy,constructor})=>{
    const bypass=encoding==="utf-8-sig"?["ignore","replace","surrogatepass","backslashreplace","xmlcharrefreplace"].includes(policy):encoding==="cp1252"?["strict","ignore","replace","xmlcharrefreplace"].includes(policy):false;
    const expression=constructor?`bytes(source, '${encoding}', '${policy}')`:`source.encode('${encoding}', '${policy}')`;
    const expected=bypass?policy==="ignore"?"''":policy==="replace"?"'?'":policy==="xmlcharrefreplace"?"'&#55296;'":String.raw`'\\ud800'`:"'!'";
    const expectedBytes=bypass&&policy==="surrogatepass"?String.raw`b'\xef\xbb\xbf\xed\xa0\x80'`:`${expected}.encode('${encoding}')`;
    run(`
import _codecs
source = '\\ud800'
seen = []
def handler(error):
    seen.append(error)
    assert error.object is source
    return ('!', error.end)
_codecs.register_error('${policy}', handler)
${bypass&&policy==="strict"?`try:
    ${expression}
except UnicodeEncodeError as error:
    assert error.object is source
    assert (error.encoding, error.start, error.end, error.reason) == ('charmap', 0, 1, 'character maps to <undefined>')
else:
    assert False`:`assert ${expression} == ${expectedBytes}`}
assert len(seen) == ${bypass?0:1}
`);
  });

it.each(encodings)("caches %s recovery while preserving input mutation and subtype index order",encoding=>{
  run(`
import _codecs
events = []
source = '\\ud800X\\ud801'
class Text(str):
    def __str__(self):
        raise AssertionError('coercion')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual tuple')
class Position:
    def __index__(self):
        events.append('index')
        retained.object = 'mutated'
        return retained.end
def replacement(error):
    events.append('new')
    return ('!', error.end)
def handler(error):
    global retained
    if not events:
        assert error.object is source
        retained = error
    else:
        assert error is retained
        assert error.object == 'mutated'
    events.append('handler')
    _codecs.register_error('custom', replacement)
    return Pair((Text('?'), Position()))
_codecs.register_error('custom', handler)
assert source.encode('${encoding}', 'custom') == '?X?'.encode('${encoding}')
assert events == ['handler', 'index', 'handler', 'index']
assert retained.args[1] is source
assert retained.object == 'mutated'
assert '\\ud800'.encode('${encoding}', 'custom') == '!'.encode('${encoding}')
assert events[-1] == 'new'
`);
});

it.each(encodings)("keeps %s error lookup lazy and propagates guest failures",encoding=>{
  run(`
import _codecs
assert 'A'.encode('${encoding}', 'unregistered') == 'A'.encode('${encoding}')
failure = ValueError('guest')
def handler(error):
    raise failure
_codecs.register_error('custom', handler)
try:
    '\\ud800'.encode('${encoding}', 'custom')
except ValueError as caught:
    assert caught is failure
else:
    assert False
`);
});

it.each(encodings)("cancels %s recovery before guest execution resumes",encoding=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return 'value\n';}},output:{write(){},flush(){}}});
  const result=session.exec(`
import _codecs
def handler(error):
    input()
    raise AssertionError('resumed')
_codecs.register_error('custom', handler)
'\\ud800'.encode('${encoding}', 'custom')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:'terminated',reason:'cancelled'});
});

const invalidResults=[
  ["(None, 0)","TypeError","encoding error handler must return (str/bytes, int) tuple"],
  ["('?', object())","TypeError","'object' object cannot be interpreted as an integer"],
  ["('?', 1 << 63)","OverflowError","Python int too large to convert to C ssize_t"],
  ["('?', 2)","IndexError","position 2 from error handler out of bounds"],
  ["('?', -2)","IndexError","position -1 from error handler out of bounds"],
];
it.each(encodings.flatMap(encoding=>invalidResults.map(([result,type,message])=>({encoding,result,type,message}))))(
  "validates $encoding handler result $result",({encoding,result,type,message})=>{
    run(`
import _codecs
_codecs.register_error('custom', lambda error: ${result})
try:
    '\\ud800'.encode('${encoding}', 'custom')
except ${type} as error:
    assert error.args == (${JSON.stringify(message)},)
else:
    assert False
`);
  });

it.each(encodings)("supports recursive %s callbacks with independent exception caches",encoding=>{
  run(`
import _codecs
seen = []
def handler(error):
    seen.append(error)
    if error.object == '\\ud800':
        assert '\\ud801'.encode('${encoding}', 'custom') == '!'.encode('${encoding}')
    return ('!', error.end)
_codecs.register_error('custom', handler)
assert '\\ud800'.encode('${encoding}', 'custom') == '!'.encode('${encoding}')
assert len(seen) == 2
assert seen[0] is not seen[1]
assert seen[0].object == '\\ud800'
assert seen[1].object == '\\ud801'
`);
});

it("preserves the UTF-8-SIG surrogateescape prefix before invoking registered recovery",()=>{
  run(`
import _codecs
seen = []
def handler(error):
    seen.append((error.start, error.end, error.object))
    return ('!', error.end)
_codecs.register_error('surrogateescape', handler)
assert '\\udc80\\ud800'.encode('utf-8-sig', 'surrogateescape') == b'\\xef\\xbb\\xbf\\x80!'
assert seen == [(1, 2, '\\udc80\\ud800')]
`);
});
