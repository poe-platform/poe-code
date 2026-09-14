import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

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

it.each(["'input'.encode('registered')","bytes('input', 'registered')"])("uses the session registry for %s",expression=>{
  run(`
import _codecs
seen = []
def encode(value, errors='strict'):
    seen.append((value, errors))
    return (b'registered', object())
def search(name):
    if name == 'registered':
        return (encode, None, None, None)
_codecs.register(search)
assert ${expression} == b'registered'
assert seen == [('input', 'strict')]
`);
});

it.each(["'\\ud800'.encode('utf-8', 'strict')","bytes('\\ud800', 'utf-8', 'strict')","b'\\xff'.decode('utf-8', 'strict')","str(b'\\xff', 'utf-8', 'strict')","b'\\xff'.decode('ascii', 'strict')"])("uses registered strict recovery for %s",expression=>{
  run(`
import _codecs
seen = []
def handler(error):
    seen.append((type(error).__name__, error.start, error.end))
    return ('!', -1 if len(error.object) > 1 else 1)
_codecs.register_error('strict', handler)
result = ${expression}
assert result == b'!' or result == '!'
assert len(seen) == 1
`);
});

it("retains negative resume positions and mutated decode input in text conversions",()=>{
  run(`
import _codecs
seen = []
def handler(error):
    seen.append(error)
    error.object = b'XY'
    return ('?', -1)
_codecs.register_error('resume', handler)
assert b'\\xff'.decode('ascii', 'resume') == '?Y'
assert seen[0].object == b'XY'
assert seen[0].args[1] == b'\\xff'
`);
});

it("preserves guest error identity through native text recovery",()=>{
  run(`
import _codecs
failure = ValueError('guest')
def handler(error):
    raise failure
_codecs.register_error('failure', handler)
try:
    b'\\xff'.decode('utf-8', 'failure')
except ValueError as caught:
    assert caught is failure
else:
    assert False
`);
});

it("cancels native text recovery without resuming the guest callback",()=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return 'value\n';}},output:{write(){},flush(){}}});
  const result=session.exec(`
import _codecs
def handler(error):
    input()
    raise AssertionError('resumed')
_codecs.register_error('cancel', handler)
b'\\xff'.decode('utf-8', 'cancel')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:'terminated',reason:'cancelled'});
});


it("shares encoder lookup caching and invalidation with imported registry functions",()=>{
  run(`
import _codecs
seen = []
def encode(value, errors='strict'):
    return (b'old', 0)
def replacement(value, errors='strict'):
    return (b'new', 0)
def search(name):
    seen.append(name)
    return (encode, None, None, None)
_codecs.register(search)
assert 'A'.encode('CACHE-TEST') == b'old'
assert bytes('A', 'cache test') == b'old'
assert seen == ['cache_test']
_codecs.unregister(search)
_codecs.register(lambda name: (replacement, None, None, None))
assert 'A'.encode('CACHE-TEST') == b'new'
`);
});

it("caches recovery per conversion and applies reentrant registration on the next conversion",()=>{
  run(`
import _codecs
seen = []
def replacement(error):
    seen.append('new')
    return ('!', error.end)
def handler(error):
    seen.append(error)
    _codecs.register_error('cached', replacement)
    return ('?', error.end)
_codecs.register_error('cached', handler)
assert b'\\xffX\\xfe'.decode('ascii', 'cached') == '?X?'
assert seen[0] is seen[1]
assert b'\\xff'.decode('ascii', 'cached') == '!'
assert seen[2] == 'new'
`);
});
