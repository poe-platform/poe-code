import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each([
  "utf8.ucs2","utf8.ucs4","us.ascii","iso.8859.1","iso.8859.1.1987","ansi.x3.4.1968"
])("decodes registered dotted alias %s",encoding=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:2000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(`assert str(b'A', '${encoding}') == 'A'`).status).toBe("ok");
});

it.each([
  "utf8.ucs2","utf8.ucs4","us.ascii","iso.8859.1","iso.8859.1.1987","ansi.x3.4.1968"
])("compiles byte source using registered dotted alias %s",encoding=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:2000000,maxDepth:100},hashSeed:[1n,2n]});
  const source=Uint8Array.from(`# coding: ${encoding}\nassert 1 == 1\n`,character=>character.charCodeAt(0));
  expect(session.exec(source,{filename:"codec_source.py"})).toEqual({status:"ok"});
});

it.each(["utf.8","latin.1","utf.8.sig"])("rejects dotted canonical source codec %s",encoding=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:2000000,maxDepth:100},hashSeed:[1n,2n]});
  const source=Uint8Array.from(`# coding: ${encoding}\nassert 1 == 1\n`,character=>character.charCodeAt(0));
  expect(session.exec(source,{filename:"codec_source.py"})).toMatchObject({status:"diagnostic",diagnostic:{name:"SyntaxError",message:`unknown encoding: ${encoding}`,filename:"codec_source.py"}});
});

it.each(["utf.8","latin.1","utf.8.sig"])("does not treat dotted canonical module %s as an alias",encoding=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:2000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(`try:
    str(b'A', '${encoding}')
except LookupError as error:
    assert error.args == ('unknown encoding: ${encoding}',)
else:
    assert False`).status).toBe("ok");
});

it.each([
  "'é'.encode('ascii', name)",
  "'Ā'.encode('latin-1', name)",
  "'\\ud800'.encode('utf-8', name)",
  "'\\ud800'.encode('utf-8-sig', name)",
  "str(b'\\xff', 'ascii', name)",
  "str(b'\\xff', 'utf-8', name)",
  "str(b'\\xef\\xbb\\xbf\\xff', 'utf-8-sig', name)"
])("bounds missing-handler diagnostics through public conversion: %s",operation=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(`for prefix, tail in [('x' * 400, 'x'), ('é' * 200, 'é'), ('a' * 399, '💥'), ('a' * 397 + '€', 'x')]:
    name = prefix + tail
    try:
        ${operation}
    except LookupError as error:
        assert error.args == ("unknown error handler name '" + prefix + "'",)
    else:
        assert False`).status).toBe("ok");
});
