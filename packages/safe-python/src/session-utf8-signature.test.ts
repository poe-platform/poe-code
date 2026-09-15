import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each([
  "assert ''.encode('utf-8-sig') == b'\\xef\\xbb\\xbf'",
  "assert 'A🐍'.encode('UTF 8 SIG') == b'\\xef\\xbb\\xbfA\\xf0\\x9f\\x90\\x8d'",
  "assert '\\ud800'.encode('utf_8_sig', 'surrogatepass') == b'\\xef\\xbb\\xbf\\xed\\xa0\\x80'",
  "assert 'A'.encode('utf-8-sig', 'missing') == b'\\xef\\xbb\\xbfA'",
  "assert str(b'\\xef\\xbb\\xbfA', 'utf-8-sig') == 'A'",
  "assert str(b'\\xef\\xbb\\xbf\\xed\\xa0\\x80', 'utf-8-sig', 'surrogatepass') == '\\ud800'",
  "assert str(b'\\xef\\xbb\\xbf\\xef\\xbb\\xbf', 'utf-8-sig') == '\\ufeff'",
  "assert str(b'\\xef\\xbb\\xbf', 'utf-8-sig', 'missing') == ''",
  "assert b'\\xef\\xbb\\xbfA'.decode('utf-8-sig') == 'A'",
  "exec(b'\\xef\\xbb\\xbfx = 42')\nassert x == 42",
  "exec(b'# coding: utf-8-sig\\nx = 42')\nassert x == 42",
  "try:\n    str(b'\\xef\\xbb\\xbf\\xff', 'utf-8-sig')\nexcept UnicodeDecodeError as error:\n    assert (error.encoding, error.object, error.start, error.end, error.reason) == ('utf-8', b'\\xff', 0, 1, 'invalid start byte')\nelse:\n    assert False",
  "try:\n    '\\ud800'.encode('utf-8-sig')\nexcept UnicodeEncodeError as error:\n    assert (error.encoding, error.object, error.start, error.end, error.reason) == ('utf-8', '\\ud800', 0, 1, 'surrogates not allowed')\nelse:\n    assert False",
])("public UTF-8 signature conversion: %s",source=>{
  // Non-fast-path text conversion executes the real guest codec library.
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source).status).toBe("ok");
});
