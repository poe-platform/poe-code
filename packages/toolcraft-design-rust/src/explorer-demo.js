import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {runExplorer} from "./explorer.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const data=native.designExplorerDemoData();
const truthyEnvValues=new Set(data.truthyEnvValues);
const policy=createComponentPolicy(native.designExplorerDemoPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,object:()=>({}),array:(...items)=>items,
  define:(object,key,value)=>{Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});},
  nullish:value=>value==null,truthy:value=>!!value,lt:(a,b)=>a<b,same:(a,b)=>a===b,at:(object,key)=>object[key],
  truthyEnv:value=>truthyEnvValues.has(value.toLowerCase()),joinLines:lines=>lines.join("\n"),
  startsWith:(arg,prefix)=>arg.startsWith(prefix),slice:(arg,offset)=>arg.slice(offset),
  unsupported(value){throw new Error(`Unsupported explorer demo mode: ${value}`);},
  title:mode=>`Explorer Demo - ${mode}`,missing:title=>`# ${title}\n\nNo demo detail is available.`,
  opened:title=>`Opened ${title}`,resolved:title=>`Resolved ${title}`,archivePrefix:length=>`Archived ${length} row`,concat:(a,b)=>a+b,
  rows:rows=>({rows:async()=>rows}).rows,
  singleItems:(slow,data)=>({items:async(row,ctx)=>{await delayDetailIfNeeded(slow,ctx);return policy("singleItems",[data,row]);}}).items,
  reviewItems:(slow,data)=>({items:async(row,ctx)=>{await delayDetailIfNeeded(slow,ctx);return policy("reviewItems",[data,row]);}}).items,
  renderMarkdown:markdown=>({render:()=>markdown}).render,
  renderComment:comment=>({render:()=>comment.body}).render,
  mapComments:comments=>comments.map(comment=>policy("comment",[comment])),
  label:label=>({label:()=>label}).label,
  handler:kind=>({handler:ctx=>{policy(kind,[ctx]);}}).handler,
  refreshHandler:()=>({handler:async ctx=>{await ctx.refresh();policy("refreshed",[ctx]);}}).handler,
  reorder(){return ()=>undefined;},
  toast(method,ctx,message,tone){
    if(typeof method!=="function")throw new TypeError("ctx.toast is not a function");
    return Reflect.apply(method,ctx,[message,tone]);
  },
  invalidOperation(){throw new TypeError("Invalid explorer demo operation");}
});
policy("initialize",[data]);
const detailDelayMs=policy("delayMs",[]);

export function parseExplorerDemoOptions(argv=process.argv.slice(2),env=process.env){return policy("parse",[argv,env]);}
export function buildExplorerDemoConfig(options){return policy("config",[options,data]);}
export async function main(){const options=parseExplorerDemoOptions();await runExplorer(buildExplorerDemoConfig(options));}

async function delayDetailIfNeeded(slowDetail,ctx){
  if(!policy("delay",[slowDetail]))return;
  await new Promise(resolve=>{
    const timeout=setTimeout(resolve,detailDelayMs);
    ctx.signal.addEventListener("abort",()=>{clearTimeout(timeout);resolve();},{once:true});
  });
}
const entry=process.argv[1];
const isMain=typeof entry==="string"&&path.resolve(entry)===fileURLToPath(import.meta.url);
if(isMain){
  main().catch(error=>{
    const message=error instanceof Error?error.message:String(error);
    process.stderr.write(`${message}\n`);process.exitCode=1;
  });
}
