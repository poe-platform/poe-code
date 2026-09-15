import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-iterator-binding-3.14.7.json";

export const bytesIteratorContracts = [
  {name:"native type and descriptors",source:String.raw`
i = iter(b'abc')
T = type(i)
assert T.__name__ == 'bytes_iterator'
assert T is type(bytes.__iter__(b''))
assert T.__base__ is object
assert T.__doc__ is None
assert set(T.__dict__) == {'__iter__', '__next__', '__length_hint__', '__reduce__', '__setstate__', '__doc__'}
for name in ('__iter__', '__next__', '__length_hint__', '__reduce__', '__setstate__'):
    descriptor = getattr(T, name)
    bound = getattr(i, name)
    assert descriptor.__objclass__ is T
    assert bound.__self__ is i
    assert descriptor.__name__ == name
    assert descriptor.__qualname__ == 'bytes_iterator.' + name
    assert descriptor.__text_signature__ == ('($self, object, /)' if name == '__setstate__' else '($self, /)')
    assert type(descriptor).__name__ == ('wrapper_descriptor' if name in ('__iter__', '__next__') else 'method_descriptor')
assert iter(i) is i
assert i.__iter__() is i
assert T.__iter__(i) is i
assert T.__next__(i) == 97
assert next(i) == 98
assert i.__next__() == 99
assert next(i, None) is None
assert i.__length_hint__() == 0
try:
    T()
except TypeError as error:
    assert str(error) == "cannot create 'bytes_iterator' instances"
else:
    assert False
try:
    class Bad(T):
        pass
except TypeError as error:
    assert str(error) == "type 'bytes_iterator' is not an acceptable base type"
else:
    assert False
`},
  {name:"source identity and exhaustion state",source:String.raw`
class B(bytes):
    pass
for source in (b'', b'abc', B(b'abc')):
    i = bytes.__iter__(source)
    assert i.__reduce__() == (iter, (source,), 0)
    assert i.__reduce__()[1][0] is source
    assert i.__length_hint__() == len(source)
    assert i.__setstate__(len(source)) is None
    assert i.__reduce__() == (iter, (source,), len(source))
    i.__setstate__(-5)
    assert list(i) == list(source)
    assert i.__reduce__() == (iter, ((),))
    i.__setstate__(0)
    assert list(i) == []
i = iter(b'abc')
next(i)
factory, args, state = i.__reduce__()
copy = factory(*args)
copy.__setstate__(state)
assert bytes(copy) == b'bc'
assert bytes(i) == b'bc'
`},
  {name:"state validation uses native integers",source:String.raw`
class Index:
    def __index__(self):
        assert False
class Int(int):
    def __index__(self):
        assert False
i = iter(b'abc')
for state, kind, message in [(1.0, TypeError, 'an integer is required'), (None, TypeError, 'an integer is required'), (Index(), TypeError, 'an integer is required'), (2**100, OverflowError, 'Python int too large to convert to C ssize_t'), (-2**100, OverflowError, 'Python int too large to convert to C ssize_t')]:
    for exhausted in (False, True):
        if exhausted:
            list(i)
        try:
            i.__setstate__(state)
        except kind as error:
            assert str(error) == message
        else:
            assert False
i = iter(b'abc')
i.__setstate__(Int(1))
assert next(i) == 98
i.__setstate__(False)
assert next(i) == 97
i.__setstate__(2**63 - 1)
assert i.__length_hint__() == 0
i.__setstate__(-2**63)
assert next(i) == 97
`},
  {name:"reduction uses active builtins before reading cursor",source:String.raw`
i = iter(b'abc')
original = iter
def reduce():
    return i.__reduce__()
builtins = reduce.__builtins__
builtins['iter'] = None
assert reduce() == (None, (b'abc',), 0)
builtins['iter'] = original
assert reduce()[0] is original
del builtins['iter']
try:
    reduce()
except AttributeError as error:
    assert str(error) == 'iter'
else:
    assert False
builtins['iter'] = original
`},
  {name:"reentrant builtin lookup observes updated cursor",source:String.raw`
i = iter(b'abc')
original = iter
events = []
class Builtins(dict):
    def __getitem__(self, name):
        if name == 'iter':
            events.append(name)
            i.__setstate__(2)
            return original
        return dict.__getitem__(self, name)
def original_function():
    pass
__builtins__ = Builtins(original_function.__builtins__)
def replacement():
    return i.__reduce__()
assert replacement() == (original, (b'abc',), 2)
assert events == ['iter']
assert next(i) == 99
`},
  {name:"builtin lookup failures retain guest exceptions and frames",source:String.raw`
i = iter(b'abc')
marker = ValueError('lookup')
class Builtins(dict):
    def __getitem__(self, name):
        if name == 'iter':
            raise marker
        return dict.__getitem__(self, name)
def original_function():
    pass
__builtins__ = Builtins(original_function.__builtins__)
def replacement():
    return i.__reduce__()
try:
    replacement()
except ValueError as error:
    assert error is marker
    frames = []
    tb = error.__traceback__
    while tb is not None:
        frames.append(tb.tb_frame.f_code.co_name)
        tb = tb.tb_next
    assert frames == ['<module>', 'replacement', '__getitem__'], frames
else:
    assert False
assert next(i) == 97
`}
];

it.each(bytesIteratorContracts)("matches bytes iterator oracle: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:2000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let diagnostic:unknown=result;
  if(result.status==="exception"){session.globals.set("failure",result.exception);diagnostic=session.eval("repr(failure)");}
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==="bigint"?String(value):value)).toBe("ok");
});

it("cancels iterator reduction through the real output adapter during builtin lookup",()=>{
  const controller=new AbortController(),writes:string[]=[];
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    output:{write(text){writes.push(text);controller.abort();},flush(){}}
  });
  const result=session.exec(`
i = iter(b'abc')
class Builtins(dict):
    def __getitem__(self, name):
        if name == 'iter':
            print('cancel')
        return dict.__getitem__(self, name)
def original_function():
    pass
__builtins__ = Builtins(original_function.__builtins__)
def replacement():
    return i.__reduce__()
try:
    replacement()
except BaseException:
    print('recovered')
`);
  expect(writes).toEqual(["cancel"]);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
});

it.each(reference.rows)("matches bytes iterator argument binding: $source",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`
${reference.setup}
try:
    result = ${source}
    if result is i:
        actual = ('self', type(result).__name__)
    elif ${source.includes("__reduce__")?"True":"False"}:
        actual = (type(result).__name__, result[0] is iter, result[1], result[2:])
    else:
        actual = (type(result).__name__, repr(result))
except BaseException as error:
    actual = (type(error).__name__, str(error))
`);
  expect(result.status).toBe("ok");
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{kind:"str",primitive:expected}});
});
