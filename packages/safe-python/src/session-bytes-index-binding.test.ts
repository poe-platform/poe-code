import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

export const bytesIndexBindingContracts = [
  {name:"TypeError while binding __index__ permits iterable fallback",source:String.raw`
events = []
failure = TypeError('binding failed')
class Slot:
    def __get__(self, obj, owner):
        events.append('get')
        raise failure
class Source:
    __index__ = Slot()
    def __iter__(self):
        events.append('iter')
        return iter([65])
assert bytes(Source()) == b'A'
assert events == ['get', 'iter']
`},
  {name:"other __index__ binding errors propagate unchanged",source:String.raw`
for kind in (ValueError, AttributeError, OverflowError):
    failure = kind('binding failed')
    class Slot:
        def __get__(self, obj, owner):
            raise failure
    class Source:
        __index__ = Slot()
        def __iter__(self):
            assert False
    try:
        bytes(Source())
    except kind as error:
        assert error is failure
    else:
        assert False
`},
  {name:"__bytes__ binding TypeError never permits fallback",source:String.raw`
failure = TypeError('binding failed')
class Slot:
    def __get__(self, obj, owner):
        raise failure
class Source:
    __bytes__ = Slot()
    def __index__(self):
        assert False
    def __iter__(self):
        assert False
try:
    bytes(Source())
except TypeError as error:
    assert error is failure
else:
    assert False
`}
];

it.each(bytesIndexBindingContracts)("matches bytes index binding: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let diagnostic:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    diagnostic=session.eval("repr(failure)");
  }
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==="bigint"?String(value):value)).toBe("ok");
});
