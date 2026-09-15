import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each([
  "assert ''.encode('unicode_escape') == b''",
  "assert ''.encode('raw_unicode_escape') == b''",
  "assert 'A\\n\\t\\r\\x00\\xff🐍\\ud800\\udc00'.encode('unicode-escape') == b'A\\\\n\\\\t\\\\r\\\\x00\\\\xff\\\\U0001f40d\\\\ud800\\\\udc00'",
  "assert 'A\\n\\t\\r\\x00\\xff🐍\\ud800\\udc00'.encode('raw-unicode-escape') == b'A\\n\\t\\r\\x00\\xff\\\\U0001f40d\\\\ud800\\\\udc00'",
  "for policy in ['strict', 'ignore', 'replace', 'surrogateescape', 'surrogatepass', 'backslashreplace', 'xmlcharrefreplace', 'namereplace', 'missing']:\n    assert '\\ud800'.encode('unicode_escape', policy) == b'\\\\ud800'\n    assert '\\ud800'.encode('raw_unicode_escape', policy) == b'\\\\ud800'",
  "assert '\\N{TANGUT IDEOGRAPH-17000}'.encode('unicode_escape') == b'\\\\U00017000'",
])("public escape encoding: %s",source=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source).status).toBe("ok");
});
