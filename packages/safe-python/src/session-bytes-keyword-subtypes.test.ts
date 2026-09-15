import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-keyword-subtypes-3.14.7.json";

it.each(reference.rows)("preserves bytes constructor keyword lookup: $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1_000_000,maxAllocatedBytes:8_000_000,maxDepth:1000},hashSeed:[0n,0n]});
  expect(session.exec(source)).toEqual({status:"ok"});
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{primitive:expected}});
});

it.each(["lookup","diagnostic","truth","render"])("keeps bytes keyword %s cancellation fatal",stage=>{
  const controller=new AbortController(),writes:string[]=[];
  const session=new PythonSession({limits:{maxSteps:200_000,maxAllocatedBytes:4_000_000,maxDepth:100},hashSeed:[0n,0n],signal:controller.signal,
    output:{write(text){writes.push(text);controller.abort();},flush(){}}
  });
  expect(session.exec(`
class Truth:
    def __bool__(self):
        ${stage==="truth"?"print('cancel')":"pass"}
        return False
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        ${stage==="lookup"||stage==="diagnostic"?"print('cancel')":"pass"}
        return Truth()
    def __str__(self):
        ${stage==="render"?"print('cancel')":"pass"}
        return 'visible'
try:
    bytes(**{Key('${stage==="lookup"?"source":"sourc"}'): [65]})
except BaseException:
    print('recovered')
`)).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(writes).toEqual(["cancel"]);
});
