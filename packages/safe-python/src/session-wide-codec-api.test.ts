import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import oracle from "./runtime/__snapshots__/wide-codec-api-3.14.7.json";
import {wideCodecApiCases} from "./wide-codec-api-cases.js";

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

it("retains the complete pinned wide codec oracle inventory",()=>{
  expect(oracle.python.startsWith("3.14.7 ")).toBe(true);
  expect(oracle.unicode).toBe("16.0.0");
  expect(oracle.cases.map(({name,expression})=>({name,expression}))).toEqual(wideCodecApiCases);
});

it.each(oracle.cases)("matches CPython 3.14.7: $name",test=>run(`
import _codecs
${test.error===undefined?`assert repr(${test.expression}) == ${JSON.stringify(test.value)}`:`try:
    ${test.expression}
except ${test.error} as error:
    assert type(error).__name__ == ${JSON.stringify(test.error)}
    assert repr(error.args) == ${JSON.stringify(test.args)}, repr(error.args)
else:
    assert False`}
`));

for(const width of [16,32]){
  for(const suffix of ["","_le","_be"]){
    const codec=`utf_${width}${suffix}`;
    it(`publishes ${codec} with pinned metadata and positional argument validation`,()=>run(`
import _codecs
encode = _codecs.${codec}_encode
decode = _codecs.${codec}_decode
assert encode.__name__ == '${codec}_encode'
assert decode.__name__ == '${codec}_decode'
assert encode.__module__ == decode.__module__ == '_codecs'
assert encode.__doc__ is decode.__doc__ is None
assert encode.__text_signature__ == '($module, str, errors=None${suffix===""?", byteorder=0":""}, /)'
assert decode.__text_signature__ == '($module, data, errors=None, final=False, /)'
for function in (encode, decode):
    try:
        function()
    except TypeError as error:
        assert error.args == (function.__name__ + ' expected at least 1 argument, got 0',)
    else:
        assert False
    try:
        function(None, errors=None)
    except TypeError as error:
        assert error.args == ('_codecs.' + function.__name__ + '() takes no keyword arguments',)
    else:
        assert False
assert encode('A😀')[1] == 2
assert decode(encode('A😀')[0], None, True) == ('A😀', len(encode('A😀')[0]))
assert encode('', 'missing') == (''.encode('${codec}'), 0)
assert decode(b'', 'missing', True) == ('', 0)
`));

    it(`retains every split input in ${codec}`,()=>run(`
import _codecs
data = 'A😀Z'.encode('${codec}')
for split in range(len(data) + 1):
    prefix, consumed = _codecs.${codec}_decode(data[:split])
    suffix, rest = _codecs.${codec}_decode(data[consumed:], None, True)
    assert prefix + suffix == 'A😀Z', (split, prefix, suffix)
    assert consumed + rest == len(data)
`));

    it(`uses owning registry recovery and negative resume positions for ${codec}`,()=>run(String.raw`
import _codecs
events = []
class Text(str):
    pass
source = Text('\ud800X\udfff')
def encode_error(error):
    assert error.object is source
    events.append(error)
    return ('?', -2 if error.start == 0 else len(source))
_codecs.register_error('wide', encode_error)
assert _codecs.${codec}_encode(source, 'wide') == ('?X?'.encode('${codec}'), 3)
assert events[0] is events[1]
def decode_error(error):
    events.append(error)
    error.object = 'XY'.encode('utf_${width}${suffix==="_be"?"_be":"_le"}')
    return ('?', -${width/8})
_codecs.register_error('wide', decode_error)
assert _codecs.${codec}_decode(b'\xff', 'wide', True) == ('?Y', 1)
`));

    it(`propagates guest failure identity from ${codec}`,()=>run(String.raw`
import _codecs
failure = ValueError('guest')
def broken(error):
    raise failure
_codecs.register_error('broken', broken)
for operation in (lambda: _codecs.${codec}_encode('\ud800', 'broken'), lambda: _codecs.${codec}_decode(b'\xff', 'broken', True)):
    try:
        operation()
    except ValueError as error:
        assert error is failure
    else:
        assert False
`));

    it(`validates recovery results and position side effects in ${codec}`,()=>run(String.raw`
import _codecs
events = []
class Position:
    def __index__(self):
        events.append('index')
        return 1 << 63
def handler(error):
    return replacement
_codecs.register_error('result', handler)
for encode in (True, False):
    for replacement, expected, message in (
        (None, TypeError, 'encoding error handler must return (str/bytes, int) tuple' if encode else 'decoding error handler must return (str, int) tuple'),
        (('?',), TypeError, 'encoding error handler must return (str/bytes, int) tuple' if encode else 'decoding error handler must return (str, int) tuple'),
        (('?', -2), IndexError, 'position -1 from error handler out of bounds'),
        (('?', 2), IndexError, 'position 2 from error handler out of bounds'),
        (('?', Position()), OverflowError, 'Python int too large to convert to C ssize_t'),
        ((None, Position()), OverflowError if encode else TypeError, 'Python int too large to convert to C ssize_t' if encode else 'decoding error handler must return (str, int) tuple'),
    ):
        events.clear()
        try:
            if encode:
                _codecs.${codec}_encode('\ud800', 'result')
            else:
                _codecs.${codec}_decode(b'\xff', 'result', True)
        except expected as error:
            assert type(error) is expected
            assert error.args == (message,), error.args
            assert events == (['index'] if expected is OverflowError else [])
        else:
            assert False
`));

    it(`looks up every overridden error policy lazily in ${codec}`,()=>run(String.raw`
import _codecs
events = []
def handler(error):
    events.append(error)
    return ('!', error.end)
for name in ('strict', 'ignore', 'replace', 'backslashreplace', 'xmlcharrefreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
    _codecs.register_error(name, handler)
    assert _codecs.${codec}_encode('\ud800', name) == ('!'.encode('${codec}'), 1)
    assert _codecs.${codec}_decode(b'\xff', name, True) == ('!', 1)
assert len(events) == 16
`));
  }

  it(`preserves arbitrary C-int byte order and BOM detection in UTF-${width}`,()=>run(`
import _codecs
encode = _codecs.utf_${width}_encode
decode = _codecs.utf_${width}_ex_decode
assert decode.__text_signature__ == '($module, data, errors=None, byteorder=0, final=False,\\n                 /)'
for order in (-2147483648, -2, -1, 0, 1, 2, 2147483647):
    data, consumed = encode('A😀', None, order)
    assert consumed == 2
    assert decode(data, None, order, True) == ('A😀', len(data), -1 if order == 0 else order)
    if order != 0:
        assert data == 'A😀'.encode('utf_${width}_le' if order < 0 else 'utf_${width}_be')
for order in (-1, 1):
    data = ('\\ufeffA').encode('utf_${width}_le' if order < 0 else 'utf_${width}_be')
    assert decode(data, None, 0, True) == ('A', len(data), order)
    assert decode(data, None, order, True) == ('\\ufeffA', len(data), order)
for order in (-2147483649, 2147483648):
    for function, data in ((encode, ''), (decode, b'')):
        try:
            function(data, None, order)
        except OverflowError as error:
            assert error.args == ('Python int too large to convert to C int',)
        else:
            assert False
`));

  it(`orders UTF-${width} argument callbacks before lazy error lookup`,()=>run(`
import _codecs
events = []
class Order:
    def __index__(self):
        events.append('index')
        return -2
class Final:
    def __bool__(self):
        events.append('final')
        return True
assert _codecs.utf_${width}_ex_decode(b'', 'missing', Order(), Final()) == ('', 0, -2)
assert events == ['index', 'final']
`));

  it.each(["encode","decode"])(`cancels UTF-${width} %s recovery without returning to guest`,operation=>{
    const controller=new AbortController();let reads=0;
    const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      input:{readLine(){reads++;controller.abort();return "value\n";}},output:{write(){},flush(){}}});
    const result=session.exec(String.raw`
import _codecs
def cancel(error):
    input()
    raise AssertionError('resumed')
_codecs.register_error('cancel', cancel)
_codecs.utf_${width}_${operation}(${operation==="encode"?"'\\ud800', 'cancel'":"b'\\xff', 'cancel', True"})
`);
    expect(reads).toBe(1);
    expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  });
}
