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

it("publishes the native UTF-7 functions with positional-only metadata and lazy errors",()=>{
  run(`
import _codecs
encode = _codecs.utf_7_encode
decode = _codecs.utf_7_decode
assert encode.__name__ == 'utf_7_encode'
assert decode.__name__ == 'utf_7_decode'
assert encode.__module__ == decode.__module__ == '_codecs'
assert encode.__text_signature__ == '($module, str, errors=None, /)'
assert decode.__text_signature__ == '($module, data, errors=None, final=False, /)'
assert encode.__doc__ is None
assert decode.__doc__ is None
for errors in (None, 'strict', 'missing'):
    assert encode('Aé+\\ud800', errors) == (b'A+AOkAK9gA-', 4)
    assert encode('', errors) == (b'', 0)
    assert decode(b'A+-', errors) == ('A+', 3)
    assert decode(b'', errors) == ('', 0)
`);
});

it.each(["utf_7_encode","utf_7_decode"])("validates %s arguments before invoking callbacks",name=>{
  const encode=name.endsWith("encode"),input=encode?"'A'":"b'A'",maximum=encode?2:3;
  run(`
import _codecs
codec = _codecs.${name}
try:
    codec()
except TypeError as error:
    assert error.args == ('${name} expected at least 1 argument, got 0',)
else:
    assert False
try:
    codec(${input}, None, False, False)
except TypeError as error:
    assert error.args == ('${name} expected at most ${maximum} arguments, got 4',)
else:
    assert False
try:
    codec(${input}, errors='strict')
except TypeError as error:
    assert error.args == ('_codecs.${name}() takes no keyword arguments',)
else:
    assert False
for errors in (42, [], object()):
    try:
        codec(${input}, errors)
    except TypeError as error:
        assert error.args == ('${name}() argument 2 must be str or None, not ' + type(errors).__name__,)
    else:
        assert False
try:
    codec(${input}, 'bad\\x00name')
except ValueError as error:
    assert error.args == ('embedded null character',)
else:
    assert False
`);
});

it("decodes every shifted-run split and distinguishes incomplete from final input",()=>{
  run(`
import _codecs
data = b'A+2D3eAA-B+AOk-'
expected = 'A😀Bé'
for split in range(len(data) + 1):
    first, consumed = _codecs.utf_7_decode(data[:split])
    last, remaining = _codecs.utf_7_decode(data[consumed:], None, True)
    assert first + last == expected
    assert consumed + remaining == len(data)
assert _codecs.utf_7_decode(b'+2AA-') == ('\\ud800', 5)
assert _codecs.utf_7_decode(b'+A') == ('', 0)
try:
    _codecs.utf_7_decode(b'+A', 'strict', True)
except UnicodeDecodeError as error:
    assert (error.encoding, error.object, error.start, error.end, error.reason) == ('utf7', b'+A', 0, 2, 'unterminated shift sequence')
else:
    assert False
`);
});

it("uses registered recovery, negative index positions and mutated input",()=>{
  run(`
import _codecs
events = []
class Position:
    def __index__(self):
        events.append('index')
        retained.object = b'XY'
        return -1
def handler(error):
    global retained
    retained = error
    events.append((error.encoding, error.object, error.start, error.end, error.reason))
    return ('?', Position())
_codecs.register_error('utf7_resume', handler)
assert _codecs.utf_7_decode(b'\\xff', 'utf7_resume', True) == ('?Y', 1)
assert events == [('utf7', b'\\xff', 0, 1, 'unexpected special character'), 'index']
assert retained.object == b'XY'
assert retained.args == ('utf7', b'\\xff', 0, 1, 'unexpected special character')
`);
});

it.each(["strict","ignore","replace","backslashreplace","surrogateescape","surrogatepass","xmlcharrefreplace","namereplace"])("uses registered %s and caches the handler and exception per UTF-7 operation",policy=>{
  run(`
import _codecs
seen = []
def replacement(error):
    seen.append('new')
    return ('!', error.end)
def handler(error):
    seen.append(error)
    _codecs.register_error('${policy}', replacement)
    return ('?', error.end)
_codecs.register_error('${policy}', handler)
assert _codecs.utf_7_encode('\\ud800', '${policy}') == (b'+2AA-', 1)
assert seen == []
assert _codecs.utf_7_decode(b'\\xffX\\xfe', '${policy}', True) == ('?X?', 3)
assert seen[0] is seen[1]
assert seen[0].args == ('utf7', b'\\xffX\\xfe', 0, 1, 'unexpected special character')
assert (seen[0].start, seen[0].end) == (2, 3)
assert _codecs.utf_7_decode(b'\\xff', '${policy}', True) == ('!', 1)
assert seen[2] == 'new'
`);
});

it("uses native subtype storage and validates errors before final truth callbacks",()=>{
  run(`
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes')
events = []
class Final:
    def __bool__(self):
        events.append('final')
        return True
assert _codecs.utf_7_encode(Text('é'), Text('missing')) == (b'+AOk-', 1)
assert _codecs.utf_7_decode(Data(b'+AOk-'), Text('strict'), Final()) == ('é', 5)
assert events == ['final']
events.clear()
for errors in (42, 'bad\\x00name', Text('\\ud800')):
    try:
        _codecs.utf_7_decode(b'A', errors, Final())
    except (TypeError, ValueError):
        pass
    else:
        assert False
assert events == []
`);
});

it("validates recovery tuple shape, replacements and adjusted positions",()=>{
  run(`
import _codecs
result = None
_codecs.register_error('utf7_result', lambda error: result)
for result in (None, ['?', 1], ('?',), (b'?', 1)):
    try:
        _codecs.utf_7_decode(b'\\xff', 'utf7_result', True)
    except TypeError as error:
        assert error.args == ('decoding error handler must return (str, int) tuple',)
    else:
        assert False
for result, kind, message in [(('?', -2), IndexError, 'position -1 from error handler out of bounds'), (('?', 2), IndexError, 'position 2 from error handler out of bounds'), (('?', 1 << 63), OverflowError, 'Python int too large to convert to C ssize_t')]:
    try:
        _codecs.utf_7_decode(b'\\xff', 'utf7_result', True)
    except (IndexError, OverflowError) as error:
        assert type(error) is kind
        assert error.args == (message,)
    else:
        assert False
`);
});

it("preserves decoder guest failures, traceback and native-call note behavior",()=>{
  run(`
import _codecs
failure = ValueError('guest')
def handler(error):
    raise failure
_codecs.register_error('utf7_failure', handler)
try:
    _codecs.utf_7_decode(b'\\xff', 'utf7_failure', True)
except ValueError as error:
    assert error is failure
    assert error.args == ('guest',)
    assert not hasattr(error, '__notes__')
    assert error.__traceback__ is not None, 'UTF-7 callback traceback'
else:
    assert False
`);
});

it.each(["final","recovery"])("cancels UTF-7 %s callbacks without resuming guest execution",stage=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return "value\n";}},output:{write(){},flush(){}}});
  const result=session.exec(`
import _codecs
class Final:
    def __bool__(self):
        input()
        raise AssertionError('resumed')
def handler(error):
    input()
    raise AssertionError('resumed')
_codecs.register_error('utf7_cancel', handler)
_codecs.utf_7_decode(b'\\xff', 'utf7_cancel', ${stage==="final"?"Final()":"True"})
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
});
