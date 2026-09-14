import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

export const bytesNewDiagnosticContract=String.raw`
for name in ('X' * 400, '\u03bb' * 201, '\U0001f40d' * 100):
    T = type(name, (), {})
    for value, message in (
        (T, 'bytes.__new__(' + name + '): ' + name + ' is not a subtype of bytes'),
        (T(), 'bytes.__new__(X): X is not a type object (' + name + ')'),
    ):
        try:
            bytes.__new__(value)
        except TypeError as error:
            assert str(error) == message, (str(error), message)
            assert error.args == (message,)
        else:
            assert False
`;

it("preserves full type names in bytes.__new__ rejection diagnostics",()=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(bytesNewDiagnosticContract);
  let diagnostic:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    diagnostic=session.eval("repr(failure)");
  }
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==="bigint"?String(value):value)).toBe("ok");
});
