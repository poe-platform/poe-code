import { PagedStorage } from "@poe-code/safe-fs/storage";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
async function fixture(content: string | string[], amend?: (doc: PdfDocument) => void, backed = false) {
  const original=PdfDocument.create();const page=original.addPage();const stream=(text:string)=>original.cos.allocateObject(cosStream(new TextEncoder().encode(text)));
  dictSet(page.pageDict,"Contents",Array.isArray(content)?cosArray(content.map(stream)):stream(content));dictSet(page.pageDict,"Resources",cosDict({Properties:cosDict({Marked:cosDict({MCID:cosNumber(0)})})}));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!,"StructTreeRoot",cosDict({Type:cosName("StructTreeRoot"),RoleMap:cosDict({Fancy:cosName("H1")}),K:cosDict({S:cosName("Fancy"),Pg:page.ref,K:cosNumber(0)})}));amend?.(original);
  if(backed){const resources=original.cos.resolveDict(dictGet(page.pageDict,"Resources"))!;dictSet(resources,"Properties",original.cos.allocateObject(dictGet(resources,"Properties")!));}
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",original.save());const source=await PdfFileSource.open(fs,"/input");const backing=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal});const document=await PdfRetainedDocument.open(source,{fs,directory:"/scratch"},{chunkBytes:64,...(backed?{valueArrays:{dictionaryStorage:backing,storedDictionaryKeys:["Properties"]}}:{})});
  return {document,fs,source,async close(){await document.close();await backing.close();await source.close();expect(await fs.readdir("/scratch")).toEqual([]);}};
}
async function collect(document: PdfRetainedDocument, includeText=true){let output="";for await(const item of document.structure({includeText})){const pad="  ".repeat(item.depth);if(item.kind==="element")output+=pad+item.role+(item.mappedRole&&item.mappedRole!==item.role?` / ${item.mappedRole}`:"")+"\n";else{const decoder=new TextDecoder();let text="";for await(const bytes of item.contents())text+=decoder.decode(bytes,{stream:true});text+=decoder.decode();if(text)output+=pad+`"${text}"\n`;}}return output;}
it.each([
 {content:"/P << /MCID 0 >> BDC BT (one) Tj ET BT [(two) -150 (three)] TJ ET EMC",text:"one two three"},
 {content:"BT /P << /MCID 0 >> BDC (one) Tj /Span BMC (two) Tj EMC (three) Tj EMC ET",text:"one two three"},
 {content:"/P << /MCID 0 >> BDC BT (discard) Tj BT (keep) Tj ET EMC",text:"keep"},
 {content:"/P << /MCID 0 >> BDC BT (discard) Tj BT ET EMC",text:""},
 {content:"/P << /MCID 0 >> BDC BT (  padded  ) Tj ET BT ( end ) Tj ET EMC",text:"padded    end"},
 {content:"/P << /MCID 0 >> BDC BT (left) Tj q (middle) Tj Q (right) Tj ET EMC",text:"left middle right"},
 {content:"q /P << /MCID 0 >> BDC BT (one) Tj Q (excluded) Tj EMC ET",text:"one"},
 {content:"/P /Marked BDC BT (named) Tj ET EMC",text:"named"},
 {content:"/P << /MCID 0 >> BDC BT (left) Tj /P << /MCID 1 >> BDC (excluded) Tj EMC (right) Tj ET EMC",text:"left right"},
])("streams structure text preserving parser grouping: $text",async({content,text})=>{const f=await fixture(content);expect(await collect(f.document)).toBe('StructTreeRoot\n  Fancy / H1\n'+(text?`    "${text}"\n`:""));await f.close();});
it.each([false,true])("joins content ranges with named properties (backed=%s)",async backed=>{const f=await fixture(["/P /Marked BDC BT (left","right) Tj ET EMC"],undefined,backed);expect(await collect(f.document)).toContain('"leftright"');await f.close();});
it("inspects roles without decoding contents when text is disabled",async()=>{const f=await fixture("/P /Marked BDC BT (text) Tj ET EMC");const decode=vi.spyOn(f.document.objects,"decodeStream");expect(await collect(f.document,false)).toBe("StructTreeRoot\n  Fancy / H1\n");expect(decode).not.toHaveBeenCalled();await f.close();});

it("preserves alternate text, inherited pages and MCR content",async()=>{
  const f=await fixture("/P /Marked BDC BT (  mcid  ) Tj ET EMC",doc=>{
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"StructTreeRoot",cosDict({K:cosArray([cosDict({S:cosName("Document"),Pg:doc.getPage(0).ref,ActualText:cosString("verbatim  "),K:cosDict({Type:cosName("MCR"),MCID:cosNumber(0)})}),cosDict({S:cosName("P"),Alt:cosString("fallback")})])}));
  });
  expect(await collect(f.document)).toBe('StructTreeRoot\n  Document\n    "verbatim  "\n    "mcid"\n  P\n    "fallback"\n');await f.close();
});
it("cleans staged MCID text on document close while its consumer is suspended",async()=>{
  const f=await fixture("/P /Marked BDC BT ("+"word ".repeat(1000)+") Tj ET EMC");const walk=f.document.structure({includeText:true});await walk.next();await walk.next();const item=(await walk.next()).value!;if(item.kind!=="text")throw new Error("missing text");const payload=item.contents();expect((await payload.next()).done).toBe(false);
  await f.close();await expect(payload.next()).rejects.toThrow("closed");expect((await walk.next()).done).toBe(true);
});
it("expires text handles when the structure walk advances",async()=>{
  const f=await fixture("/P /Marked BDC BT (text) Tj ET EMC");const walk=f.document.structure({includeText:true});await walk.next();await walk.next();const item=(await walk.next()).value!;if(item.kind!=="text")throw new Error("missing text");await walk.next();await expect(item.contents().next()).rejects.toThrow("closed");await f.close();
});
it("spills deep marked-content state instead of retaining a growing graphics stack",async()=>{
  const f=await fixture("/P /Marked BDC "+"q ".repeat(97)+"BT (deep) Tj ET "+"Q ".repeat(97)+"EMC");expect(await collect(f.document)).toContain('"deep"');await f.close();
});
it("skips active structure cycles without suppressing later sibling occurrences",async()=>{
  const f=await fixture("",doc=>{const child=doc.cos.allocateObject(cosDict({S:cosName("P")}));dictSet(doc.cos.resolveDict(child)!,"K",child);dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"StructTreeRoot",cosDict({K:cosArray([child,child])}));});expect(await collect(f.document,false)).toBe("StructTreeRoot\n  P\n  P\n");await f.close();
});
it("trims Unicode whitespace and BOMs without corrupting UTF-8 byte offsets",async()=>{
  const f=await fixture("/P /Marked BDC BT <FEFFFEFF2003D83DDE42002000E92003> Tj ET EMC");expect(await collect(f.document)).toContain('"🙂 é"');await f.close();
});

it("preserves staging failures and cleans partial structure text",async()=>{
  const f=await fixture("/P /Marked BDC BT (text) Tj ET EMC");const baseline=await f.fs.readdir("/scratch"),failure=new Error("structure storage failed"),create=f.fs.createStagedFile!.bind(f.fs);
  const spy=vi.spyOn(f.fs,"createStagedFile").mockImplementation(async(...args)=>{const staging=await create(...args);return {...staging,writer:{...staging.writer!,write:async()=>{throw failure;}}};});
  await expect(collect(f.document)).rejects.toBe(failure);spy.mockRestore();expect(await f.fs.readdir("/scratch")).toEqual(baseline);await f.close();
});
it("yields to timers during staged structure-text reads",async()=>{
  const f=await fixture("/P /Marked BDC BT ("+"word ".repeat(2000)+") Tj ET EMC");const walk=f.document.structure({includeText:true});await walk.next();await walk.next();const item=(await walk.next()).value!;if(item.kind!=="text")throw new Error("missing text");
  let fired=false,count=0;const timer=setTimeout(()=>{fired=true;},0);for await(const ignored of item.contents()){count++;if(fired)break;}clearTimeout(timer);expect(fired).toBe(true);expect(count).toBeLessThan(150);await walk.return();await f.close();
});
