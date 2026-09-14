import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each([
  ["utf-8","\\xed\\xa0\\x80\\xff","surrogatepass","utf-8",0,1,"invalid continuation byte",3,4,"invalid start byte"],
  ["utf-8-sig","\\xef\\xbb\\xbf\\xed\\xa0\\x80\\xff","surrogatepass","utf-8",0,1,"invalid continuation byte",3,4,"invalid start byte"],
  ["utf-7","\\xff+A-","surrogateescape","utf7",0,1,"unexpected special character",1,4,"partial character in shift sequence"],
] as const)("preserves initial error args after built-in recovery: %s",(codec,bytes,policy,encoding,start,end,reason,lastStart,lastEnd,lastReason)=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:2000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(`
source = b'${bytes}'
try:
    source.decode('${codec}', '${policy}')
except UnicodeDecodeError as error:
    assert error.args == ('${encoding}', ${codec==="utf-8-sig"?"source[3:]":"source"}, ${start}, ${end}, '${reason}')
    assert (error.encoding, error.start, error.end, error.reason) == ('${encoding}', ${lastStart}, ${lastEnd}, '${lastReason}')
    assert error.object is error.args[1]
else:
    assert False
`).status).toBe("ok");
});
