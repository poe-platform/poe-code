import assert from "node:assert/strict";
import test from "node:test";
import {createCommandArguments, toByteSource, type CommandContext} from "safe-bash-contracts";
import {createTrashCommand, createTrashCommands, trashCommands, type TrashBackend} from "./index.js";

test("trash commands route through the atomic backend and report failures", async () => {
  const calls: string[]=[];
  const backend: TrashBackend={
    async put(path) { calls.push(path); if(path==="/denied") throw new Error("EACCES: denied"); },
    async list() { return [{item:"id",path:"/a",deletionDate:"2026-11-25T10:00:00"}]; },
    async restore(item) { calls.push(item); },
  };
  const run=async (name:string,args:string[])=>{
    let stdout="",stderr="";
    const values=createCommandArguments(args);
    const result=await createTrashCommand({backend},name).execute({
      command:name,args:values.args,argumentValues:values,cwd:"/work",env:{},
      fs:{} as CommandContext["fs"],stdin:toByteSource(""),signal:new AbortController().signal,
      stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},
      stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}},
    });
    return {...result,stdout,stderr};
  };
  assert.equal((await run("trash-put",["a","/b"])).exitCode,0);
  assert.deepEqual(calls,["/work/a","/b"]);
  assert.equal((await run("trash-put",["/denied"])).exitCode,1);
  assert.equal((await run("trash-restore",["../id"])).exitCode,1);
  assert.equal((await run("trash-restore",["id"])).exitCode,0);
  assert.equal((await run("trash-list",[])).stdout,"id\t2026-11-25T10:00:00\t/a\n");
  assert.equal(createTrashCommands({backend}).length,3);
  const registered:string[]=[];
  assert.throws(()=>trashCommands({backend}).setup({commands:{has:(name:string)=>name==="trash-list",register:(command:{name:string})=>registered.push(command.name)}} as never));
  assert.deepEqual(registered,[]);
});
