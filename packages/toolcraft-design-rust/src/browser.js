import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import process from "node:process";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designBrowserPolicy,{
  windows:(handler,url)=>[handler,url],url:url=>[url],command:(command,args)=>({command,args}),
  same:(a,b)=>a===b,isNull:value=>value===null,
  signal:signal=>`signal ${signal??"unknown"}`,code:code=>`code ${code}`,
  error:reason=>new Error(`Browser launcher exited with ${reason}`),
  unref:child=>child.unref(),resolve:resolve=>resolve(),reject:(reject,error)=>reject(error),
  invalidOperation(){throw new TypeError("Invalid browser operation");}
});

export async function openExternal(url,options={}){
  const parsed=new URL(url);
  const {command,args}=invoke("command",[parsed.href,options.platform??process.platform]);
  const spawnProcess=options.spawnProcess??spawn;
  await new Promise((resolve,reject)=>{
    const child=spawnProcess(command,args,{detached:true,stdio:"ignore"});
    child.once("error",reject);
    child.once("close",(code,signal)=>invoke("close",[child,code,signal,resolve,reject]));
  });
}
