import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

export const bytesWriterContracts = [
  {name:"iterator reservation controls single-byte identity",source:String.raw`
class Source:
    def __init__(self, hint, data):
        self.hint = hint
        self.data = data
    def __iter__(self):
        return iter(self.data)
    def __length_hint__(self):
        return self.hint
single = b'A'
empty = b''
for hint in (0, 1, 64, 511, 512, 513, 1024):
    for data in ([], [65], [65, 66]):
        a = bytes(Source(hint, data))
        b = bytes(Source(hint, data))
        assert a == bytes(data)
        assert type(a) is bytes
        if len(data) == 0:
            assert a is empty
            assert a is b
        elif len(data) == 1:
            assert (a is single) == (hint <= 512), hint
            assert (a is b) == (hint <= 512), hint
        else:
            assert a is not b
`},
  {name:"source length takes priority over iterator hint",source:String.raw`
events = []
class Source:
    def __iter__(self):
        events.append('iter')
        return iter([65])
    def __len__(self):
        events.append('len')
        return 513
    def __length_hint__(self):
        assert False
single = b'A'
result = bytes(Source())
assert result == single
assert result is not single
assert events == ['iter', 'len']
class L(list):
    def __iter__(self):
        return iter([65])
for size in (0, 512, 513):
    result = bytes(L([66] * size))
    assert result == single
    assert (result is single) == (size <= 512)
`},
  {name:"exact list reservation survives shrinking during index conversion",source:String.raw`
single = b'A'
for size in (1, 512, 513):
    items = []
    class Item:
        def __index__(self):
            items.clear()
            return 65
    items.append(Item())
    items.extend([66] * (size - 1))
    result = bytes(items)
    assert items == []
    assert result == single
    assert (result is single) == (size <= 512), size
assert bytes((65,)) is not single
assert bytes([65]) is single
`}
];

it.each(bytesWriterContracts)("matches CPython bytes writer: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let diagnostic:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    diagnostic=session.eval("repr(failure)");
  }
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==="bigint"?String(value):value)).toBe("ok");
});
