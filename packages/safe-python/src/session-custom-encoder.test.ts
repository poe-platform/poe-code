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

const consumers=["source.encode('EDGE-CUSTOM')","bytes(source, 'EDGE-CUSTOM')"];

it.each(consumers)("preserves custom encoder arguments and native subtype identity: %s",expression=>{
  run(`
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('coercion')
class Bytes(bytes):
    pass
class Pair(tuple):
    def __len__(self):
        raise AssertionError('virtual length')
    def __getitem__(self, index):
        raise AssertionError('virtual item')
source = Text('input')
result = Bytes(b'output')
seen = []
def encode(*args):
    seen.append(args)
    return Pair((result, object()))
info = (encode, None, None, None)
_codecs.register(lambda name: info if name == 'edge_custom' else None)
assert ${expression} is result
assert len(seen[0]) == 1
assert seen[0][0] is source
assert source.encode('edge custom', 'StRiCt') is result
assert seen[1] == (source, 'StRiCt')
assert ''.encode('edge_custom') is result
assert seen[2] == ('',)
assert _codecs.lookup('EDGE-CUSTOM') is info
`);
});

it.each(consumers)("validates custom encoder results without coercion or failure notes: %s",expression=>{
  run(`
import _codecs
source = 'input'
result = None
_codecs.register(lambda name: (lambda value: result, None, None, None))
for result in (None, [], (), (b'a',), (b'a', 0, 0)):
    try:
        ${expression}
    except TypeError as error:
        assert error.args == ('encoder must return a tuple (object, integer)',)
        assert not hasattr(error, '__notes__')
    else:
        assert False
result = ('wrong', object())
try:
    ${expression}
except TypeError as error:
    assert error.args == ("'EDGE-CUSTOM' encoder returned 'str' instead of 'bytes'; use codecs.encode() to encode to arbitrary types",)
    assert not hasattr(error, '__notes__')
else:
    assert False
`);
});

it.each(consumers)("preserves guest failure identity, notes and traceback: %s",expression=>{
  run(`
import _codecs
source = 'input'
failure = KeyboardInterrupt('guest')
failure.add_note('original')
def encode(value):
    raise failure
_codecs.register(lambda name: (encode, None, None, None))
try:
    ${expression}
except KeyboardInterrupt as error:
    assert error is failure, 'failure identity'
    assert error.args == ('guest',), 'failure args'
    assert error.__notes__ == ['original', "encoding with 'EDGE-CUSTOM' codec failed"], 'failure notes'
    assert error.__traceback__ is not None, 'failure traceback'
else:
    assert False
`);
});

it("reads live text metadata on cached tuple subclasses before calling custom encoders",()=>{
  run(`
import _codecs
events = []
class Info(tuple):
    _is_text_encoding = False
def encode(value):
    events.append(value)
    return (b'ok', 0)
info = Info((encode, None, None, None))
_codecs.register(lambda name: info)
for attempt in range(2):
    try:
        'input'.encode('EDGE-CUSTOM')
    except LookupError as error:
        assert error.args == ("'EDGE-CUSTOM' is not a text encoding; use codecs.encode() to handle arbitrary codecs",)
        assert not hasattr(error, '__notes__')
    else:
        assert False
assert events == []
info._is_text_encoding = True
assert 'input'.encode('EDGE-CUSTOM') == b'ok'
assert events == ['input']
`);
});

it.each(["search","encode"])("cancels registered %s callbacks without resuming guest code",stage=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return "value\n";}},output:{write(){},flush(){}}});
  const result=session.exec(`
import _codecs
def stop(value):
    input()
    raise AssertionError('resumed')
_codecs.register(${stage==="search"?"stop":"lambda name: (stop, None, None, None)"})
'input'.encode('edge_custom')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
});
