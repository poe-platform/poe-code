import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

export const bytesGetnewargsIdentitySource=String.raw`
class B(bytes):
    def __bytes__(self):
        raise AssertionError('must read native storage')
    def __iter__(self):
        raise AssertionError('must read native storage')
    def __len__(self):
        raise AssertionError('must read native storage')
class C(bytes):
    __slots__ = ()
for constructor in (bytes, B, C):
    for data in (b'', b'\x00', b'a', b'ab', b'abc' * 200):
        source = constructor(data)
        left = bytes.__getnewargs__(source)
        right = source.__getnewargs__()
        assert type(left) is tuple and len(left) == 1
        assert left is not right
        assert type(left[0]) is bytes and left[0] == data
        assert type(right[0]) is bytes and right[0] == data
        if len(data) < 2:
            assert left[0] is data and right[0] is data
        else:
            assert left[0] is not source and right[0] is not source
            assert left[0] is not right[0]
        assert bytes(*left) is left[0]
for source in (bytes(1), bytes((97,)), bytes([97, 98])):
    result = source.__getnewargs__()[0]
    assert result == source and result is not source
    if len(source) == 1:
        assert result is bytes([source[0]])
`;

it("matches CPython bytes reconstruction argument identities through guest construction",()=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(bytesGetnewargsIdentitySource);
  let diagnostic:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    diagnostic=session.eval("repr(failure)");
  }
  expect(result.status,JSON.stringify(diagnostic)).toBe("ok");
});
