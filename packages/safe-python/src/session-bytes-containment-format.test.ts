import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/bytes-containment-format-3.14.7.json";

it.each(reference.rows)("matches bytes containment and format oracle: $name",({source,expected})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source)).toEqual({status:"ok"});
  expect(session.eval("repr(actual)")).toMatchObject({status:"ok",value:{primitive:expected}});
});

it.each(["x in b'a'","x not in b'a'","b'a'.__contains__(x)","bytes.__contains__(b'a', x)"])("keeps cancellation fatal during containment: %s",expression=>{
  const controller=new AbortController(),writes:string[]=[];
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    output:{write(text){writes.push(text);controller.abort();},flush(){}}
  });
  expect(session.exec(`
class B(bytes):
    def __index__(self):
        print('cancel')
        raise ValueError('index')
x=B(b'a')
try:
    result=${expression}
except BaseException:
    print('recovered')
`)).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(writes).toEqual(["cancel"]);
  expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
});
