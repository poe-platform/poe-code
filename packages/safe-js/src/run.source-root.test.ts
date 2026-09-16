import {beforeEach,expect,it,vi} from "vitest";
import {vol} from "memfs";
vi.mock("node:fs/promises",async()=>(await import("memfs")).fs.promises);
import {run} from "./run.js";
beforeEach(()=>vol.reset());
it("uses a canonical entry identity for a rooted self import",async()=>{
  const source="import './entry.js';mark();export const value=1";
  const mark=vi.fn();
  vol.fromJSON({"/grant/entry.js":source});
  vol.symlinkSync("/grant","/alias");
  expect(await run(source,{sourceType:"module",sourceRoot:"/alias",filename:"/alias/entry.js",bindings:{mark}}))
    .toMatchObject({ok:true,returnValue:{value:1}});
  expect(mark).toHaveBeenCalledTimes(1);
});
it("resolves relative files from the granted root when no filename is supplied",async()=>{
  vol.fromJSON({"/grant/dep.js":"export const x=7"});
  expect(await run("export {x} from './dep.js'",{sourceType:"module",sourceRoot:"/grant"}))
    .toMatchObject({ok:true,returnValue:{x:7}});
});
