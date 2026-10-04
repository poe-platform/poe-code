import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {compileStoredPostScript} from "./stored-postscript.js";
import {evalShadingFunctionSteps,evalShadingFunctionToComponents} from "./evaluator.js";
import {cosStream,cosDict,cosNumber,cosArray} from "../ast.js";
import {PdfDocument} from "../document.js";

async function evaluate(text:string,signal?:AbortSignal){
 const fs=createMemoryFileSystem(),storage=new PagedStorage({fs,cwd:"/",env:{},signal:signal??new AbortController().signal},2),bytes=new TextEncoder().encode(text);
 const stream=cosStream(cosDict({FunctionType:cosNumber(4),Domain:cosArray([]),Range:cosArray([cosNumber(-1e308),cosNumber(1e308)])}),bytes),doc=PdfDocument.create().cos;
 try{
  const source=await compileStoredPostScript({size:bytes.length,async read(at,length){expect(length).toBeLessThanOrEqual(4096);return bytes.slice(at,at+length);}},storage,()=>{},signal);
  const steps=evalShadingFunctionSteps(doc,stream,[],new WeakMap([[stream,source]]));let step=steps.next();while(!step.done)step=steps.next(await step.value.source.read(step.value.position,step.value.length,signal));
  return {actual:step.value,buffered:()=>evalShadingFunctionToComponents(doc,stream,[])};
 }finally{await storage.close();expect(await fs.readdir("/")).toEqual([]);}
}
it.each([
 '{ '+ '0'.repeat(5000)+'1.25e-2 }',
 '{ 0.'+'0'.repeat(5000)+'125e5000 }',
 '{ 1'+ '0'.repeat(5000)+'e-5000 }',
 '{ '+ '9'.repeat(1300)+'e-1299 }',
 '{ 1e999999999999999999999999 }',
 '{ -0 0 add }',
 '{ %'+ 'x'.repeat(8192)+'\n true { false { 1 } { 2 } ifelse } { 3 } ifelse }',
 '{ '+ 'unknown'.repeat(1024)+' 4 add }',
])("preserves bounded token decoding (case %#)",async source=>{const result=await evaluate(source);expect(result.actual).toEqual(result.buffered());});
it("stores thousands of nested conditional frames without a recursive parser stack",async()=>{
 const depth=4096;expect((await evaluate('{ '+ 'true { '.repeat(depth)+'0.5 '+ '} if '.repeat(depth)+'}')).actual).toEqual([0.5]);
});
it.each(['{ { 1 } }','{ true { 1 } ifelse }','{ true { 1 } { 2 } if }','{ true { 1 } if','{ if }'])("rejects malformed procedures %s",async source=>{await expect(evaluate(source)).rejects.toThrow("procedure");});
it("cooperatively cancels while scanning a long comment",async()=>{
 const controller=new AbortController(),failure=new Error('cancel compile');const timer=setTimeout(()=>controller.abort(failure),0);
 try{await expect(evaluate('{ %'+'x'.repeat(65536)+'\n 1 }',controller.signal)).rejects.toBe(failure);}finally{clearTimeout(timer);}
});
