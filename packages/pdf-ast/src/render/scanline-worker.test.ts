import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

it("keeps complex fill/clip scratch bounded in a Worker",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"scanline-worker.ts",contents:`
 import {renderOperationStreamWindow} from './packages/pdf-ast/src/render/raster.ts';
 export default {async fetch(){
 const segments=Array.from({length:4096},()=>({kind:'rect',x:0,y:0,width:16,height:16}));
 const path={segments,fillColor:{r:1,g:0,b:0},strokeWidth:0,clipPaths:[{segments,fillRule:'nonzero'}]};
 const Native=Float64Array,push=Array.prototype.push;let maximum=0;
 globalThis.Float64Array=new Proxy(Native,{construct(target,args){if(typeof args[0]==='number'){maximum=Math.max(maximum,args[0]*8);if(args[0]>1024)throw Error('edge-sized scratch');}return Reflect.construct(target,args);}});
 Array.prototype.push=function(...items){if(this.length+items.length>1024)throw Error('collected geometry');return Reflect.apply(push,this,items);};
 try{const image=await renderOperationStreamWindow({width:16,height:16},async function*(){yield {kind:'path',value:path};},{x:2,y:3,width:7,height:9},{scale:1,transparent:true});
 if(image.data.some((value,index)=>value!==(index%4===0||index%4===3?255:0)))throw Error('incorrect pixels');
 return Response.json({maximum,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Float64Array=Native;Array.prototype.push=push;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text});
 try{const response=await runtime.dispatchFetch("https://verify/");if(response.status!==200)throw Error(await response.text());const result=await response.json() as {maximum:number;nodeGlobals:boolean};expect(result.maximum).toBeLessThanOrEqual(1024);expect(result.nodeGlobals).toBe(false);}finally{await runtime.dispose();}
},15000);
