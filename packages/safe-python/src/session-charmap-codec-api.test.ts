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

it("publishes charmap binding, Latin-1 defaults and native subtype validation",()=>{
  run(String.raw`
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('coercion')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('coercion')
assert _codecs.charmap_encode(Text('é'), 'absent') == (b'\xe9', 1)
assert _codecs.charmap_decode(Data(b'\xe9'), 'absent') == ('é', 1)
assert _codecs.charmap_encode('a', None, {97: b'xyz'}) == (b'xyz', 1)
assert _codecs.charmap_decode(b'a', None, {97: 'xyz'}) == ('xyz', 1)
assert _codecs.charmap_encode('', 'absent', object()) == (b'', 0)
assert _codecs.charmap_decode(b'', 'absent', object()) == ('', 0)
for operation, source in [('encode', 'a'), ('decode', b'a')]:
    f = getattr(_codecs, 'charmap_' + operation)
    assert f.__module__ == '_codecs'
    assert f.__name__ == 'charmap_' + operation
    assert f.__doc__ is None
    for args, message in [((), 'charmap_' + operation + ' expected at least 1 argument, got 0'), ((source, None, None, 0), 'charmap_' + operation + ' expected at most 3 arguments, got 4'), ((source, 42), 'charmap_' + operation + '() argument 2 must be str or None, not int')]:
        try:
            f(*args)
        except TypeError as error:
            assert error.args == (message,)
        else:
            assert False
    try:
        f(source, mapping={})
    except TypeError as error:
        assert error.args == ('_codecs.charmap_' + operation + '() takes no keyword arguments',)
    else:
        assert False
    try:
        f(source, 'strict\0')
    except ValueError as error:
        assert error.args == ('embedded null character',)
    else:
        assert False
`);
});

it("uses guest mapping subscriptions, probing order and cached error recovery",()=>{
  run(String.raw`
import _codecs
events = []
errors = []
class Mapping:
    def __getitem__(self, point):
        events.append(point)
        if point == 65:
            return b'a'
        raise KeyError(point)
def recover(error):
    errors.append(error)
    assert error.encoding == 'charmap'
    return (b'?', error.end)
_codecs.register_error('custom', recover)
source = '☃A☃'
assert _codecs.charmap_encode(source, 'custom', Mapping()) == (b'?a?', 3)
assert events == [9731, 65, 65, 9731]
assert errors[0] is errors[1]
assert errors[0].object is source
assert errors[0].args == ('charmap', source, 0, 1, 'character maps to <undefined>')
assert (errors[0].start, errors[0].end) == (2, 3)
`);
});

it("validates negative resume positions and replacement input through the shared registry",()=>{
  run(String.raw`
import _codecs
seen = []
def decode(error):
    seen.append(error)
    error.object = b'?AB'
    return ('!', -2)
_codecs.register_error('custom', decode)
assert _codecs.charmap_decode(b'?', 'custom', {65: 'a', 66: 'b'}) == ('!ab', 1)
assert seen[0].object == b'?AB'
def encode(error):
    return (b'!', -1)
_codecs.register_error('custom', encode)
assert _codecs.charmap_encode('☃A', 'custom', {65: 97}) == (b'!a', 2)
for result, expected in [(('!', -3), IndexError), (('!', 3), IndexError), (('!', 1 << 100), OverflowError), (([], 1), TypeError), (['!', 1], TypeError)]:
    _codecs.register_error('custom', lambda error: result)
    try:
        _codecs.charmap_decode(b'?', 'custom', {})
    except expected:
        pass
    else:
        assert False
`);
});

it.each(["strict","ignore","replace","backslashreplace","xmlcharrefreplace","namereplace","surrogateescape","surrogatepass"])("honors charmap native versus registered %s policy",policy=>{
  run(`
import _codecs
seen = []
def recover(error):
    seen.append(error.encoding)
    return (b'Z' if isinstance(error, UnicodeEncodeError) else 'Z', error.end)
_codecs.register_error('${policy}', recover)
assert _codecs.charmap_decode(b'?', '${policy}', {}) == ('Z', 1)
assert seen == ['charmap']
seen.clear()
${policy==="strict"?`try:
    _codecs.charmap_encode('☃', '${policy}', {})
except UnicodeEncodeError:
    pass
else:
    assert False
assert seen == []`:policy==="ignore"?`assert _codecs.charmap_encode('☃', '${policy}', {}) == (b'', 1)
assert seen == []`:policy==="replace"||policy==="xmlcharrefreplace"?`assert _codecs.charmap_encode('☃', '${policy}', {point: point for point in range(128)}) == (${policy==="replace"?"b'?'":"b'&#9731;'"}, 1)
assert seen == []`:`assert _codecs.charmap_encode('☃', '${policy}', {}) == (b'Z', 1)
assert seen == ['charmap']`}
`);
});

it.each(["encode","decode"].flatMap(operation=>["mapping","handler"].map(stage=>({operation,stage}))))("preserves $operation $stage failure identity",({operation,stage})=>{
    run(`
import _codecs
failure = KeyboardInterrupt('guest')
class Mapping:
    def __getitem__(self, point):
        ${stage==="mapping"?"raise failure":"return None"}
def recover(error):
    raise failure
_codecs.register_error('custom', recover)
try:
    _codecs.charmap_${operation}(${operation==="encode"?"'a'":"b'a'"}, 'custom', Mapping())
except KeyboardInterrupt as error:
    assert error is failure, '${stage} identity'
    assert error.__traceback__ is not None, '${stage} traceback'
    assert not hasattr(error, '__notes__'), '${stage} notes'
else:
    assert False
`);
});

it("caches recovery callbacks only within one operation and isolates interpreters",()=>{
  run(String.raw`
import _codecs
events = []
def second(error):
    events.append('second')
    return ('S', error.end)
def first(error):
    events.append('first')
    _codecs.register_error('custom', second)
    return ('F', error.end)
_codecs.register_error('custom', first)
assert _codecs.charmap_decode(b'ab', 'custom', {}) == ('FF', 2)
assert _codecs.charmap_decode(b'a', 'custom', {}) == ('S', 1)
assert events == ['first', 'first', 'second']
`);
  run(String.raw`
import _codecs
try:
    _codecs.charmap_decode(b'a', 'custom', {})
except LookupError as error:
    assert error.args == ("unknown error handler name 'custom'",)
else:
    assert False
`);
});

it("honors decoder index effects and replacement validation order",()=>{
  run(String.raw`
import _codecs
events = []
saved = None
class Position:
    def __index__(self):
        events.append('index')
        saved.object = b'?AB'
        return -2
def recover(error):
    global saved
    saved = error
    return ('!', Position())
_codecs.register_error('custom', recover)
assert _codecs.charmap_decode(b'?', 'custom', {65: 'a', 66: 'b'}) == ('!ab', 1)
assert events == ['index']
events.clear()
_codecs.register_error('custom', lambda error: ([], Position()))
try:
    _codecs.charmap_decode(b'?', 'custom', {})
except TypeError as error:
    assert error.args == ('decoding error handler must return (str, int) tuple',)
else:
    assert False
assert events == []
try:
    _codecs.charmap_encode('?', 'custom', {})
except TypeError as error:
    assert error.args == ('encoding error handler must return (str/bytes, int) tuple',)
else:
    assert False
assert events == ['index']
`);
});

it.each(["encode","decode"])("cancels %s during guest mapping or recovery",operation=>{
  for(const stage of ["mapping","handler"]){
    const controller=new AbortController();let reads=0;
    const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      input:{readLine(){reads++;controller.abort();return "value\n";}},output:{write(){},flush(){}}});
    const result=session.exec(`
import _codecs
class Mapping:
    def __getitem__(self, point):
        ${stage==="mapping"?"input()\n        raise AssertionError('resumed')":"return None"}
def recover(error):
    input()
    raise AssertionError('resumed')
_codecs.register_error('custom', recover)
_codecs.charmap_${operation}(${operation==="encode"?"'a'":"b'a'"}, 'custom', Mapping())
`);
    expect(reads).toBe(1);
    expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  }
});
