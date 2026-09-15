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

it("publishes callable native codec functions in a shared mutable module namespace",()=>{
  run(`
import _codecs
from _codecs import ascii_encode, utf_8_decode
assert type(_codecs).__name__ == 'module'
assert _codecs.__name__ == '_codecs'
assert ascii_encode is _codecs.ascii_encode
assert ascii_encode('A') == (b'A', 1)
assert utf_8_decode(b'\\xc3\\xa9', 'strict', True) == ('é', 2)
assert _codecs.__dict__['ascii_encode'] is ascii_encode
_codecs.marker = []
import _codecs as again
assert again is _codecs
assert again.marker is _codecs.__dict__['marker']
del _codecs.marker
assert not hasattr(again, 'marker')
assert ascii_encode.__module__ == '_codecs'
`);
});

it("uses real guest search and recovery callbacks through imported registry functions",()=>{
  run(`
import _codecs
seen = []
def encode(value, errors='strict'):
    seen.append((value, errors))
    return (b'ok', None)
def search(name):
    seen.append(name)
    if name == 'public_module':
        return (encode, encode, None, None)
_codecs.register(search)
assert _codecs.encode('input', 'PUBLIC-MODULE') == b'ok'
assert seen == ['public_module', ('input', 'strict')]
assert _codecs.lookup('public module') is _codecs.lookup('PUBLIC-MODULE')
_codecs.unregister(search)
def recover(error):
    error.object = b'XY'
    return ('?', 1)
_codecs.register_error('public_recovery', recover)
assert _codecs.ascii_decode(b'\\xff', 'public_recovery') == ('?Y', 1)
assert _codecs.lookup_error('public_recovery') is recover
assert _codecs._unregister_error('public_recovery') is True
assert _codecs._unregister_error('public_recovery') is False
`);
});

it("keeps codec registration local to each public session",()=>{
  run(`import _codecs\n_codecs.register_error('session_only', lambda e: ('?', e.end))`);
  run(`
import _codecs
try:
    _codecs.lookup_error('session_only')
except LookupError as error:
    assert error.args == ("unknown error handler name 'session_only'",)
else:
    assert False
`);
});

it("shares imported registrations with native text methods and constructors",()=>{
  run(`
import _codecs
seen = []
def encode(value, errors='strict'):
    seen.append(('encode', value, errors))
    return (b'encoded', object())
def decode(value, errors='strict'):
    seen.append(('decode', value, errors))
    return ('decoded', object())
info = (encode, decode, None, None)
_codecs.register(lambda name: info if name == 'public_text' else None)
assert 'input'.encode('public_text') == b'encoded'
assert bytes('input', 'public_text') == b'encoded'
assert b'input'.decode('public_text') == 'decoded'
assert str(b'input', 'public_text') == 'decoded'
assert seen == [('encode', 'input', 'strict'), ('encode', 'input', 'strict'), ('decode', b'input', 'strict'), ('decode', b'input', 'strict')]
`);
});

it("retains native fast paths and native error policy distinctions",()=>{
  run(`
import _codecs
events = []
def search(name):
    events.append(name)
    return (None, None, None, None)
def handler(error):
    return ('!', error.end)
_codecs.register(search)
for encoding in ('ascii', 'latin-1', 'utf-8'):
    assert 'A'.encode(encoding) == b'A'
    assert b'A'.decode(encoding) == 'A'
assert events == []
_codecs.register_error('replace', handler)
_codecs.register_error('strict', handler)
assert '\\ud800'.encode('utf-8', 'replace') == b'?'
assert '\\ud800'.encode('utf-8', 'strict') == b'!'
assert b'\\xff'.decode('ascii', 'strict') == '!'
try:
    'é'.encode('ascii', 'strict')
except UnicodeEncodeError as error:
    assert (error.encoding, error.object, error.start, error.end, error.reason) == ('ascii', 'é', 0, 1, 'ordinal not in range(128)')
else:
    assert False
`);
});

it("supports native module construction, namespace aliases and PEP 562 callbacks",()=>{
  run(`
import _codecs
Module = type(_codecs)
module = Module('owned', ['doc'])
namespace = module.__dict__
assert module.__doc__ == ['doc']
assert module.__package__ is None
assert module.__loader__ is None
assert module.__spec__ is None
namespace['value'] = 42
assert module.value == 42
module.__getattr__ = lambda name: 'missing:' + name
assert module.absent == 'missing:absent'
module.__dir__ = lambda: ['value']
assert dir(module) == ['value']
try:
    module.__dict__ = {}
except AttributeError:
    pass
else:
    assert False
assert module.__dict__ is namespace
`);
});

it("recovers recursively and rereads mutated decode input after subtype index callbacks",()=>{
  run(`
import _codecs
events = []
class Position:
    def __index__(self):
        events.append('index')
        retained.object = b'WXYZ'
        return -1
class Text(str):
    def __str__(self):
        raise AssertionError('coercion')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual tuple')
    def __len__(self):
        raise AssertionError('virtual tuple')
def handler(error):
    global retained
    if error.object == b'\\xfe':
        events.append('inner')
        return ('!', error.end)
    events.append('outer')
    assert _codecs.ascii_decode(b'\\xfe', 'recursive') == ('!', 1)
    retained = error
    error.object = None
    return Pair((Text('?'), Position()))
_codecs.register_error('recursive', handler)
assert _codecs.ascii_decode(b'\\xff', 'recursive') == ('?Z', 1)
assert events == ['outer', 'inner', 'index']
assert retained.args == ('ascii', b'\\xff', 0, 1, 'ordinal not in range(128)')
assert retained.object == b'WXYZ'
`);
});

it("rejects generator callbacks without starting their suspended bodies",()=>{
  run(`
import _codecs
events = []
def handler(error):
    events.append('started')
    yield ('?', error.end)
_codecs.register_error('suspended', handler)
try:
    _codecs.ascii_decode(b'\\xff', 'suspended')
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    assert False
assert events == []
`);
});

it("publishes all eight standard error handlers through the imported registry",()=>{
  run(`
import _codecs
encode = UnicodeEncodeError('ascii', 'é', 0, 1, 'reason')
decode = UnicodeDecodeError('utf-8', b'\\xed\\xa0\\x80', 0, 1, 'reason')
assert _codecs.lookup_error('ignore')(encode) == ('', 1)
assert _codecs.lookup_error('replace')(encode) == ('?', 1)
assert _codecs.lookup_error('backslashreplace')(encode) == ('\\\\xe9', 1)
assert _codecs.lookup_error('xmlcharrefreplace')(encode) == ('&#233;', 1)
assert _codecs.lookup_error('namereplace')(encode) == ('\\\\N{LATIN SMALL LETTER E WITH ACUTE}', 1)
assert _codecs.lookup_error('surrogatepass')(decode) == ('\\ud800', 3)
assert _codecs.lookup_error('surrogateescape')(decode) == ('\\udced', 1)
try:
    _codecs.lookup_error('strict')(encode)
except UnicodeEncodeError as caught:
    assert caught is encode
else:
    assert False
`);
});

it("cancels a codec callback through an explicit input service without resuming guest code",()=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return 'value\n';}},output:{write(){},flush(){}}});
  const result=session.exec(`
import _codecs
def handler(error):
    input()
    raise AssertionError('continued after cancellation')
_codecs.register_error('cancelled', handler)
_codecs.ascii_decode(b'\\xff', 'cancelled')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:'terminated',reason:'cancelled'});
  expect(session.eval('1')).toMatchObject({status:'terminated',reason:'cancelled'});
});
