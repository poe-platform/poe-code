import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-method-keyword-subtypes-3.14.7.json";

it.each(reference.rows)("preserves native bytes method keyword binding: $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source)).toEqual({status:"ok"});
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{kind:"str",primitive:expected}});
});

it("cancels native keyword error callbacks before formatting the rejected key",()=>{
  const controller=new AbortController(),writes:string[]=[];
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,output:{write(text){writes.push(text);controller.abort();},flush(){}}});
  const result=session.exec(`
class Key(str):
    def __eq__(self, other):
        print('compare')
        return False
    __hash__ = str.__hash__
    def __str__(self):
        print('format')
        return 'display'
try:
    b'abc'.hex(**{Key('unknown'): ':'})
except BaseException:
    print('caught')
`);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(writes).toEqual(["compare"]);
});
