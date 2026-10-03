import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
async function fixture(count = 1, password = "", stream = true) {
  const original = PdfDocument.create(); const page = original.addPage(); const root = original.cos.resolveDict(original.cos.rootRef)!;
  const action = (text: string, stream = false) => original.cos.allocateObject(cosDict({ S: cosName("JavaScript"), JS: stream ? original.cos.allocateObject(cosStream(new TextEncoder().encode(text))) : cosString(text) }));
  const open = action("open()"); const next = action("next()");dictSet(original.cos.resolveDict(open)!,"Next",cosArray([next,open]));dictSet(root,"OpenAction",open);
  const names = [cosString("duplicate"),open];for(let i=0;i<count;i++)names.push(cosString(`named${i}`),action("🙂".repeat(100)+i,stream));
  const tree=original.cos.allocateObject(cosDict({Names:cosArray(names)}));dictSet(original.cos.resolveDict(tree)!,"Kids",cosArray([tree]));dictSet(root,"Names",cosDict({JavaScript:tree}));
  dictSet(page.pageDict,"AA",cosDict({O:action("page()")}));
  const field=original.cos.allocateObject(cosDict({T:cosString("field"),A:action("field()"),AA:cosDict({K:action("key()")})}));dictSet(page.pageDict,"Annots",cosArray([field]));dictSet(root,"AcroForm",cosDict({Fields:cosArray([field])}));
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",original.save(password?{encrypt:{revision:3,userPassword:password}}:undefined));
  const source=await PdfFileSource.open(fs,"/input",{chunkBytes:64,cacheBytes:128});const document=await PdfRetainedDocument.open(source,{fs,directory:"/scratch"},{chunkBytes:64,cacheBytes:128,password});
  return {fs,source,document,async close(){await document.close();await source.close();expect(await fs.readdir("/scratch")).toEqual([]);}};
}
it.each(["","secret"])("streams ordered JavaScript actions, deduplicates cycles and decrypts (%s)",async password=>{
  const f=await fixture(1,password);const decode=vi.spyOn(f.document.objects,"decodeStream");const found=[];
  for await(const script of f.document.javaScripts()){
    const before=decode.mock.calls.length;let text="";const decoder=new TextDecoder();for await(const bytes of script.contents()){expect(bytes.length).toBeLessThanOrEqual(64);text+=decoder.decode(bytes,{stream:true});}text+=decoder.decode();
    if(script.name==="named0")expect(decode.mock.calls.length).toBe(before+1);found.push([script.name,text]);
  }
  expect(found).toEqual([["Document OpenAction","open()"],["Document OpenAction","next()"],["named0","🙂".repeat(100)+"0"],["Page 1 AA/O","page()"],["field Action","field()"],["field AA/K","key()"]]);await f.close();
});
it("keeps JavaScript payloads lazy and releases suspended traversal on close",async()=>{
  const f=await fixture(80);const decode=vi.spyOn(f.document.objects,"decodeStream");const scripts=f.document.javaScripts();let payload;
  for(let i=0;i<65;i++)payload=(await scripts.next()).value;
  expect(decode).not.toHaveBeenCalled();await f.close();expect((await scripts.next()).done).toBe(true);await expect(payload!.contents().next()).rejects.toThrow("closed");
});

it("chunks direct Unicode script strings without splitting surrogate pairs",async()=>{
  const f=await fixture(1,"",false);const scripts=f.document.javaScripts();await scripts.next();await scripts.next();const script=(await scripts.next()).value!;
  let text="";for await(const bytes of script.contents()){expect(bytes.length).toBeLessThanOrEqual(64);text+=new TextDecoder().decode(bytes);}expect(text).toBe("🙂".repeat(100)+"0");await scripts.return();await f.close();
});
it("cancels an active script payload when the document closes",async()=>{
  const f=await fixture();const scripts=f.document.javaScripts();await scripts.next();await scripts.next();const payload=(await scripts.next()).value!.contents();expect((await payload.next()).done).toBe(false);
  await f.document.close();await expect(payload.next()).rejects.toThrow("closed");await f.source.close();expect(await f.fs.readdir("/scratch")).toEqual([]);
});
it.each([32,4096])("keeps %i generated script chunks under consumer backpressure",async chunks=>{
  const f=await fixture();let pulls=0,closed=false;
  vi.spyOn(f.document.objects,"decodeStream").mockImplementation(async function*(){try{for(let i=0;i<chunks;i++){pulls++;yield new Uint8Array(64).fill(i%251);}}finally{closed=true;}});
  const scripts=f.document.javaScripts();await scripts.next();await scripts.next();const script=(await scripts.next()).value!;expect(pulls).toBe(0);
  let count=0;for await(const bytes of script.contents()){expect(bytes.length).toBe(64);expect(bytes[0]).toBe(count%251);expect(pulls).toBe(++count);await Promise.resolve();expect(pulls).toBe(count);}
  expect(count).toBe(chunks);expect(closed).toBe(true);await scripts.return();await f.close();
});
it("yields to timers while consuming generated script payloads",async()=>{
  const f=await fixture();vi.spyOn(f.document.objects,"decodeStream").mockImplementation(async function*(){for(let i=0;i<10000;i++)yield new Uint8Array(1);});
  const scripts=f.document.javaScripts();await scripts.next();await scripts.next();const script=(await scripts.next()).value!;
  let timerFired=false;const timer=setTimeout(()=>{timerFired=true;},0);let count=0;
  for await(const ignored of script.contents()){count++;if(timerFired)break;}
  clearTimeout(timer);expect(timerFired).toBe(true);expect(count).toBeLessThan(10000);await scripts.return();await f.close();
});
