import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const documentation="str(object='') -> str\nstr(bytes_or_buffer[, encoding[, errors]]) -> str\n\nCreate a new string object from the given object. If encoding or\nerrors is specified, then the object must expose a data buffer\nthat will be decoded using the given encoding and error handler.\nOtherwise, returns the result of object.__str__() (if defined)\nor repr(object).\nencoding defaults to 'utf-8'.\nerrors defaults to 'strict'.";

it("publishes the native string documentation reached through the bytes inventory",()=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[0n,0n]});
  const result=session.exec(`
expected = ${JSON.stringify(documentation)}
assert str.__doc__ == expected
assert str.__dict__['__doc__'] == expected
assert bytes.__doc__.__doc__ == expected
assert bytes.__dict__['__doc__'].__doc__ == expected
assert ''.__doc__ == expected
assert b''.__doc__ == bytes.__doc__
class Inherited(str):
    pass
assert Inherited.__doc__ is None
assert Inherited('').__doc__ is None
class Documented(str):
    'guest documentation'
assert Documented.__doc__ == 'guest documentation'
assert Documented('').__doc__ == 'guest documentation'
`);
  let diagnostic=result.status as string;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const rendered=session.eval("repr(failure)");
    if(rendered.status==="ok")diagnostic=String(rendered.value.primitive);
  }
  expect(result.status,diagnostic).toBe("ok");
});
