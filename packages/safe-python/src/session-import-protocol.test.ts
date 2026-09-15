import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const options=()=>({limits:{maxSteps:500_000,maxAllocatedBytes:8_000_000,maxDepth:100},hashSeed:[1n,2n] as const});

it.each([false,true])("keeps cancellation fatal across import callbacks (service throws=%s)",throws=>{
  const controller=new AbortController();
  const session=new PythonSession({...options(),signal:controller.signal,output:{write(){controller.abort();if(throws)throw Error("service failed");},flush(){}}});
  const result=session.exec(`
def importer(*args):
    print('cancel')
    return None
__builtins__['__import__'] = importer
try:
    import package
except BaseException:
    recovered = True
`);
  expect(result.status).toBe("terminated");
  if(result.status!=="terminated")throw Error("expected fatal cancellation");
  expect(result.reason).toBe("cancelled");
  expect(session.exec("assert False")).toBe(result);
});

it("preserves star-import sequence and name-validation errors",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
class Package:
    __name__ = 'package'
package = Package()
def importer(*args):
    return package
__builtins__['__import__'] = importer
for exports, message in [(None, "'NoneType' object does not support indexing"), ({0: 'x'}, 'dict is not a sequence'), ([1], 'Item in package.__all__ must be str, not int')]:
    package.__all__ = exports
    try:
        from package import *
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
package.__name__ = 42
package.__all__ = [1]
try:
    from package import *
except TypeError as error:
    assert error.args == ('module __name__ must be a string, not int',)
else:
    assert False
`)).toEqual({status:"ok"});
});

it("passes relative fromlists once and binds imported attributes in order",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
events = []
class Package:
    left = 11
    right = 12
def importer(name, globalns, localns, fromlist, level):
    events.append((name, globalns is globals(), localns is globals(), fromlist, level))
    return Package()
__builtins__['__import__'] = importer
from ..package import left as first, right
assert (first, right) == (11, 12)
assert events == [('package', True, True, ('left', 'right'), 2)]
`)).toEqual({status:"ok"});
});

it("converts missing imported attributes into exact nonmodule ImportError metadata",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
class Package:
    __name__ = 'package'
    __file__ = '/guest/package.py'
def importer(*args):
    return Package()
__builtins__['__import__'] = importer
try:
    import package.child as child
except ImportError as error:
    assert error.args == ("cannot import name 'child' from 'package' (unknown location)",)
    assert error.name == 'package'
    assert error.path is None
    assert error.name_from == 'child'
    assert error.__context__ is None
    assert error.__cause__ is None
else:
    assert False
`)).toEqual({status:"ok"});
});

it("uses star export sequence indexing and preserves partial bindings on attribute failure",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
events = []
class Exports:
    def __iter__(self):
        raise AssertionError('must use indexing')
    def __getitem__(self, index):
        events.append(index)
        return ['first', '_private', 'missing'][index]
class Package:
    __all__ = Exports()
    first = 1
    _private = 2
def importer(*args):
    assert args[3] == ('*',)
    return Package()
__builtins__['__import__'] = importer
try:
    from package import *
except AttributeError:
    pass
else:
    assert False
assert first == 1
assert _private == 2
assert events == [0, 1, 2]
`)).toEqual({status:"ok"});
});

it("star imports snapshot dictionary keys and omit private names without __all__",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
class Package:
    pass
package = Package()
package.public = 4
package._private = 5
def importer(*args):
    return package
__builtins__['__import__'] = importer
from package import *
assert public == 4
assert '_private' not in globals()
`)).toEqual({status:"ok"});
});

it("calls the captured builtin import hook with CPython module and optimized-frame arguments",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
events = []
class Package:
    pass
root = Package()
root.child = Package()
root.child.leaf = 42
def importer(name, globalns, localns, fromlist, level):
    events.append((name, globalns is globals(), localns, fromlist, level))
    return root
__builtins__['__import__'] = importer
import package.child
assert package is root
import package.child.leaf as answer
assert answer == 42
def run():
    import package as local
    return local
assert run() is root
assert events[0][0] == 'package.child'
assert events[0][1] is True
assert events[0][2] is globals()
assert events[0][3:] == (None, 0)
assert events[1][0] == 'package.child.leaf'
assert events[2] == ('package', True, None, None, 0)
`)).toEqual({status:"ok"});
});

it("looks up each import hook again and keeps completed bindings when a later import fails",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
events = []
failure = ValueError('import failure')
def second(*args):
    events.append(args[0])
    raise failure
def first(*args):
    events.append(args[0])
    __builtins__['__import__'] = second
    return 17
__builtins__['__import__'] = first
try:
    import one, two
except ValueError as error:
    assert error is failure
else:
    assert False
assert one == 17
assert events == ['one', 'two']
assert 'two' not in globals()
`)).toEqual({status:"ok"});
});

it("imports through class namespaces and suspended guest frames",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
events = []
def importer(name, globalns, localns, fromlist, level):
    events.append((name, localns))
    return 23
__builtins__['__import__'] = importer
class C:
    marker = 7
    import package as member
assert C.member == 23
assert events[0][1]['marker'] == 7
def generate():
    yield 'before'
    import package as member
    yield member
g = generate()
assert next(g) == 'before'
assert len(events) == 1
assert next(g) == 23
assert events[1] == ('package', None)
`)).toEqual({status:"ok"});
});

it("reports a missing builtin import hook as a catchable ImportError",()=>{
  const session=new PythonSession(options());
  expect(session.exec(`
__builtins__.pop('__import__', None)
try:
    import package
except ImportError as error:
    assert error.args == ('__import__ not found',)
    assert error.name is None
    assert error.path is None
else:
    assert False
`)).toEqual({status:"ok"});
});
