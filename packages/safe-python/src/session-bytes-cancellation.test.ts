import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each([
  "def __bytes__(self):\n        print('cancel')\n        return b'A'",
  "def __index__(self):\n        print('cancel')\n        return 1",
  "def __iter__(self):\n        print('cancel')\n        return iter([65])",
  "def __iter__(self):\n        return iter([65])\n    def __len__(self):\n        print('cancel')\n        return 1",
  "def __iter__(self):\n        return self\n    def __next__(self):\n        print('cancel')\n        return 65"
])("cancels bytes construction during a guest protocol callback: %s",method=>{
  const controller=new AbortController();
  const writes:string[]=[];
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    output:{write(text){writes.push(text);controller.abort();},flush(){}}
  });
  const result=session.exec(`
class Source:
    ${method}
try:
    bytes(Source())
except BaseException:
    recovered = True
`);
  expect(writes).toEqual(["cancel"]);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
});

it("charges an iterator's reservation before advancing it",()=>{
  const writes:string[]=[];
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],
    output:{write(text){writes.push(text);},flush(){}}
  });
  const result=session.exec(`
class Source:
    def __iter__(self):
        return self
    def __length_hint__(self):
        return 10000000
    def __next__(self):
        print('advanced')
        return 65
try:
    bytes(Source())
except BaseException:
    print('recovered')
`);
  expect(result).toMatchObject({status:"terminated",reason:"allocation"});
  expect(writes).toEqual([]);
});
