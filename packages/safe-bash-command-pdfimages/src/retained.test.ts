import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdfimagesCommand, runPdfimagesCli } from "./index.js";

it.each([false, true])("streams retained image extraction without whole-file I/O (stdin=%s)", async stdin => {
  const doc = PdfDocument.create(); const page = doc.addPage([32,32]);
  page.drawImage(doc.embedRgbImage(2,2,new Uint8Array([255,0,0,0,255,0,0,0,255,255,255,255])),{x:0,y:0,width:16,height:16});
  const input = doc.save(); const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); await fs.writeFile("/in.pdf",input);
  const expected = new Map([["in.pdf", input]]); await runPdfimagesCli(["-png","in.pdf","out"],expected);
  const read = vi.fn(async () => { throw new Error("whole read forbidden"); });
  const write = vi.fn(async () => { throw new Error("whole write forbidden"); });
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return read;
    if (key === "writeFile") return write;
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const args = createCommandArguments(["-png",stdin ? "-" : "in.pdf","out"]);
  const result = await createPdfimagesCommand({limits:{maxInputBytes:input.length}}).execute({command:"pdfimages",args:args.args,argumentValues:args,cwd:"/",env:{},fs:injected,stdin:(async function*(){if(stdin)for(let at=0;at<input.length;at+=37)yield input.slice(at,at+37);})(),signal:new AbortController().signal,stdout:{write:async()=>{}},stderr:{write:async()=>{}}});
  expect(result.exitCode).toBe(0); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  expect(await fs.readFile("/out-000.png")).toEqual(expected.get("out-000.png"));expect(await fs.readdir("/tmp")).toEqual([]);
});

async function compareCommand(input: Uint8Array, flags: string[]) {
  const argv = [...flags,"in.pdf",...(flags.includes("-list") ? [] : ["out"])];
  const expected = new Map([["in.pdf",input]]); const reference = await runPdfimagesCli(argv, expected);
  const fs = createMemoryFileSystem();await fs.mkdir("/tmp");await fs.writeFile("/in.pdf",input);
  const args = createCommandArguments(argv);let stdout="",stderr="";
  const result = await createPdfimagesCommand().execute({command:"pdfimages",args:args.args,argumentValues:args,cwd:"/",env:{},fs,stdin:(async function*(){})(),signal:new AbortController().signal,stdout:{write:async bytes=>{await Promise.resolve();stdout+=new TextDecoder().decode(bytes);}},stderr:{write:async bytes=>{stderr+=new TextDecoder().decode(bytes);}}});
  expect({...result,stdout,stderr}).toEqual(reference);
  for(const [path,bytes] of expected)expect(await fs.readFile(`/${path}`),path).toEqual(bytes);
  expect(await fs.readdir("/tmp")).toEqual([]);
}
it.each([[],["-png"],["-tiff"],["-list"],["-u","-p","-print-filenames"],["-f","2","-l","2","-min-width","2","-png"],["-min-height","100"],["-f","8"]].map(flags=>({flags})))("preserves retained listing, selection and outputs for $flags",async ({flags})=>{
  const doc=PdfDocument.create();const first=doc.addPage([32,32]),second=doc.addPage([32,32]);const image=doc.embedRgbImage(2,2,new Uint8Array([255,0,0,0,255,0,0,0,255,255,255,255]));
  first.drawImage(image,{x:0,y:0,width:16,height:16});first.drawImage(image,{x:0,y:16,width:32,height:16});second.drawImage(image,{x:0,y:0,width:8,height:8});
  await compareCommand(doc.save(),flags);
});
it.each(["DCTDecode","JPXDecode","JBIG2Decode","CCITTFaxDecode"])("preserves retained native %s payloads and sidecars",async filter=>{
  const {readFileSync}=await import("node:fs"); const {cosDict,cosName,cosNumber,cosStream,dictSet}=await import("@poe-code/pdf-ast");
  const fixture=(name:string)=>new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`,import.meta.url)));
  const doc=PdfDocument.create();const page=doc.addPage([72,72]);
  const bytes=filter==="DCTDecode"?fixture("jpeg-RGB-0-0-17.jpg"):filter==="JPXDecode"?fixture("rgb-tiled.jp2"):filter==="JBIG2Decode"?fixture("jbig2-symbols.0000"):new Uint8Array([255]);
  const dict=cosDict({Subtype:cosName("Image"),Width:cosNumber(filter==="JBIG2Decode"?64:8),Height:cosNumber(filter==="JBIG2Decode"?32:2),BitsPerComponent:cosNumber(filter==="JBIG2Decode"||filter==="CCITTFaxDecode"?1:8),ColorSpace:cosName(filter==="JBIG2Decode"||filter==="CCITTFaxDecode"?"DeviceGray":"DeviceRGB"),Filter:cosName(filter)});
  if(filter==="JBIG2Decode")dictSet(dict,"DecodeParms",cosDict({JBIG2Globals:doc.cos.allocateObject(cosStream(fixture("jbig2-symbols.sym")))}));
  if(filter==="CCITTFaxDecode")dictSet(dict,"DecodeParms",cosDict({K:cosNumber(-1),Columns:cosNumber(8),Rows:cosNumber(2)}));
  dictSet(page.pageDict,"Resources",cosDict({XObject:cosDict({I:doc.cos.allocateObject(cosStream(dict,bytes))})}));dictSet(page.pageDict,"Contents",doc.cos.allocateObject(cosStream(new TextEncoder().encode("/I Do"))));
  const input=doc.save({encrypt:{revision:3,userPassword:"secret"}});
  await compareCommand(input,["-all","-p","-print-filenames","-upw","secret"]);await compareCommand(input,["-list","-upw","secret"]);
});
it.each(["cancel","budget"])("keeps the original destination and cleans staging on %s failure",async mode=>{
  const {bindFileOutputBudget}=await import("safe-bash-contracts/filesystem-output-budget");
  const doc=PdfDocument.create();const page=doc.addPage([256,256]);page.drawImage(doc.embedRgbImage(256,256,new Uint8Array(256*256*3).fill(37)),{x:0,y:0,width:256,height:256});
  const fs=createMemoryFileSystem();await fs.mkdir("/tmp");await fs.writeFile("/in.pdf",doc.save());await fs.writeFile("/out-000.ppm",new TextEncoder().encode("original"));
  const args=createCommandArguments(["in.pdf","out"]),controller=new AbortController(),failure=new Error("stop output");let pending=0,peak=0;const publish=vi.fn();
  const injected=new Proxy(fs,{get(target,key){if(key==="publishStagedFile")return async(...args:Parameters<typeof fs.publishStagedFile>)=>{publish();return target.publishStagedFile(...args);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const context={command:"pdfimages",args:args.args,argumentValues:args,cwd:"/",env:{},fs:injected,stdin:(async function*(){})(),signal:controller.signal,registerCleanup(){},stdout:{write:async()=>{}},stderr:{write:async()=>{}}};
  bindFileOutputBudget(context,sink=>({async write(bytes){pending+=bytes.length;peak=Math.max(peak,pending);await Promise.resolve();if(mode==="budget")throw failure;await sink.write(bytes);pending-=bytes.length;controller.abort(failure);}}));
  await expect(createPdfimagesCommand().execute(context)).rejects.toBe(failure);
  expect(publish).not.toHaveBeenCalled();expect(peak).toBeLessThanOrEqual(65536);expect(await fs.readFile("/out-000.ppm")).toEqual(new TextEncoder().encode("original"));expect(await fs.readdir("/tmp")).toEqual([]);expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["in.pdf","out-000.ppm","tmp"]);
});
it("validates later image decoders before publishing earlier outputs",async()=>{
  const {cosDict,cosName,cosNumber,cosStream,dictSet}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();const page=doc.addPage([8,8]);page.drawImage(doc.embedRgbImage(1,1,new Uint8Array([255,0,0])),{x:0,y:0,width:8,height:8});
  const bad=doc.addPage([8,8]);dictSet(bad.pageDict,"Resources",cosDict({XObject:cosDict({I:doc.cos.allocateObject(cosStream(cosDict({Subtype:cosName("Image"),Width:cosNumber(1),Height:cosNumber(1),Filter:cosName("JPXDecode")}),new Uint8Array([0])))})}));dictSet(bad.pageDict,"Contents",doc.cos.allocateObject(cosStream(new TextEncoder().encode("/I Do"))));
  const fs=createMemoryFileSystem();await fs.mkdir("/tmp");await fs.writeFile("/in.pdf",doc.save());const args=createCommandArguments(["in.pdf","out"]);
  await expect(createPdfimagesCommand().execute({command:"pdfimages",args:args.args,argumentValues:args,cwd:"/",env:{},fs,stdin:(async function*(){})(),signal:new AbortController().signal,stdout:{write:async()=>{}},stderr:{write:async()=>{}}})).rejects.toThrow();
  expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["in.pdf","tmp"]);expect(await fs.readdir("/tmp")).toEqual([]);
});
it("preserves inline CCITT payloads and sidecar defaults",async()=>{
  const {cosStream,dictSet}=await import("@poe-code/pdf-ast");const doc=PdfDocument.create();const page=doc.addPage([8,8]);
  const prefix=new TextEncoder().encode("BI /W 8 /H 2 /BPC 1 /CS /G /F /CCF /DP << /K -1 /Columns 8 /Rows 2 >> ID ");const suffix=new TextEncoder().encode(" EI");const bytes=new Uint8Array(prefix.length+1+suffix.length);bytes.set(prefix);bytes[prefix.length]=255;bytes.set(suffix,prefix.length+1);
  dictSet(page.pageDict,"Contents",doc.cos.allocateObject(cosStream(bytes)));await compareCommand(doc.save(),["-all","-print-filenames"]);
});
