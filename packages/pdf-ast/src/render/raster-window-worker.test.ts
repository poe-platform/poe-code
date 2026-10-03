import {expect,test} from 'vitest';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

test('renders a tiny PDF window in a Worker without allocating the page',async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../../../../',import.meta.url)),sourcefile:'pdf-window-worker.ts',contents:`
 import {renderDisplayListWindowSteps} from './packages/pdf-ast/src/render/raster.ts';
 export default {fetch(){
 const path={segments:[{kind:'move',x:0,y:0},{kind:'line',x:1000000,y:0},{kind:'line',x:1000000,y:1000000},{kind:'line',x:0,y:1000000},{kind:'close'}],fillColor:{r:1,g:0,b:0},strokeWidth:0};
 const paint={kind:'path',value:path},list={pageIndex:0,width:1000000,height:1000000,rotation:0,glyphs:[],paths:[],images:[],annotations:[],operations:[paint,{kind:'group',value:{alpha:.5,isolated:false,operations:[{kind:'path',value:{...path,fillColor:{r:0,g:0,b:1},blendMode:'Multiply'}}]}}]};
 const originals=[Uint8Array,Float32Array,ArrayBuffer],names=['Uint8Array','Float32Array','ArrayBuffer'];let maximum=0;
 for(let i=0;i<names.length;i++)globalThis[names[i]]=new Proxy(originals[i],{construct(target,args){const value=args[0],length=typeof value==='number'?value*(i===1?4:1):value?.byteLength??0;maximum=Math.max(maximum,length);if(length>65536)throw Error('unbounded surface '+length);return Reflect.construct(target,args);}});
 try{const steps=renderDisplayListWindowSteps(list,{x:127,y:255,width:7,height:9},{scale:1});let next=steps.next();while(!next.done)next=steps.next();return Response.json({width:next.value.width,height:next.value.height,pixels:Array.from(next.value.data),maximum,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{for(let i=0;i<names.length;i++)globalThis[names[i]]=originals[i];}
 }};`},bundle:true,write:false,platform:'browser',conditions:['workerd'],format:'esm',metafile:true,logLevel:'silent'});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:bundle.outputFiles[0]!.text});
 try{const response=await runtime.dispatchFetch('https://verify/');if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {width:number;height:number;pixels:number[];maximum:number;nodeGlobals:boolean};expect(result).toMatchObject({width:7,height:9,nodeGlobals:false});expect(result.maximum).toBeLessThanOrEqual(65536);expect(result.pixels).toEqual(Array.from({length:63},()=>[127,0,0,255]).flat());}finally{await runtime.dispose();}
},15000);
