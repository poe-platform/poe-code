import {describe,it,expect} from "vitest";
import {createFsFromVolume,Volume} from "memfs";
import * as own from "../dist/runtime.js";
import * as reference from "../../poe-code-config/dist/runtime.js";

for(const [name,api] of [["native companion",own],["reference",reference]] as const)describe(name,()=>{
  it("returns promises for host resolution and invalid config",async()=>{
    const host=api.resolveRuntime({cwd:"/repo",config:{runtime:api.parseRuntime(undefined)}});
    expect(host).toBeInstanceOf(Promise);expect(await host).toMatchObject({runner:"host"});
    await expect(api.resolveRuntime({cwd:"/repo",config:{}} as never)).rejects.toThrow("runtime config is required");
  });
  it("uses injected asynchronous filesystem methods and rejects symlink escapes",async()=>{
    const volume=Volume.fromJSON({"/repo/.poe-code/Dockerfile":"FROM scratch","/outside/Dockerfile":"FROM scratch"});
    const fs=createFsFromVolume(volume);const trace:string[]=[];
    const injected={async stat(path:string){trace.push("stat:"+path);return await fs.promises.stat(path);},async realpath(path:string){trace.push("realpath:"+path);return await fs.promises.realpath(path);}};
    const config={runtime:api.parseRuntime({type:"docker"})};
    expect(await api.resolveRuntime({cwd:"/repo",config,fs:injected} as never)).toMatchObject({dockerfilePath:"/repo/.poe-code/Dockerfile",buildContext:"/repo"});
    expect(trace).toEqual(["stat:/repo/.poe-code/Dockerfile","stat:/repo","realpath:/repo","realpath:/repo/.poe-code/Dockerfile","realpath:/repo","realpath:/repo"]);
    await fs.promises.symlink("/outside","/repo/escape");
    await expect(api.resolveRuntime({cwd:"/repo",config:{runtime:api.parseRuntime({type:"docker",dockerfile:"escape/Dockerfile"})},fs:injected} as never)).rejects.toThrow("runtime.dockerfile must remain inside runtime cwd /repo");
  });
  it("maps only missing path errors and preserves other filesystem failures",async()=>{
    for(const code of ["ENOENT","ENOTDIR","EACCES"]){
      const failure=Object.assign(new Error("filesystem failure"),{code}),fs={async stat(){throw failure;},async realpath(){throw new Error("unexpected realpath");}};
      const pending=api.resolveRuntime({cwd:"/repo",config:{runtime:api.parseRuntime({type:"docker"})},fs} as never);
      if(code==="EACCES")await expect(pending).rejects.toBe(failure);else await expect(pending).rejects.toThrow("Docker runtime requires image or a Dockerfile at /repo/.poe-code/Dockerfile");
    }
  });
  it("resolves relative runtime roots from the portable filesystem root",async()=>{
    const fs={async stat(){return {};},async realpath(path:string){return path.startsWith("/")?path:"/"+path;}};
    expect(await api.resolveRuntime({cwd:"repo",config:{runtime:api.parseRuntime({type:"docker"})},fs} as never)).toMatchObject({dockerfilePath:"/repo/.poe-code/Dockerfile",buildContext:"/repo"});
  });
});
