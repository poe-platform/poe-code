import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictDelete, dictSet } from "../ast.js";
import { setDocumentFormField } from "./forms.js";
import { saveRetainedDocumentChunks } from "./retained-save.js";
import { editRetainedDocument } from "./retained-graph.js";

it.each(["text", "button", "choice", "multi", "new", "direct", "nested", "password", "comb", "widgets", "duplicate", "repeated", "inherited", "button-widgets", "button-off"])("retains exact %s field update bytes", async mode => {
  const original = PdfDocument.create(); original.addPage();
  const field = cosDict({ T: cosString("field"), FT: cosName(mode.startsWith("button") ? "Btn" : mode === "choice" || mode === "multi" ? "Ch" : "Tx"), Rect: cosArray([0,0,120,20].map(v => cosNumber(v))) });
  if (mode === "choice" || mode === "multi") dictSet(field, "Opt", cosArray([cosArray([cosString("one"), cosString("First")]), cosString("two")]));
  if (["multi", "password", "comb", "widgets", "duplicate", "repeated", "inherited", "button-widgets", "button-off"].includes(mode)) dictSet(field,"Ff",cosNumber(1 << (mode === "multi" ? 21 : mode === "password" ? 13 : 24)));
  if(mode === "comb") dictSet(field,"MaxLen",cosNumber(8));
  if (mode === "widgets" || mode.startsWith("button-")) {
    const kid = original.cos.allocateObject(cosDict({Subtype:cosName("Widget"),Rect:cosArray([0,0,80,20].map(v=>cosNumber(v)))}));
    dictSet(field,"Kids",cosArray([kid]));
    if(mode.startsWith("button-")) dictSet(original.cos.resolveDict(kid)!, "AP", cosDict({N:cosDict({Selected:cosDict({}),Off:cosDict({})})}));
  }
  let entry = mode === "direct" ? field : original.cos.allocateObject(field);
  if(mode === "nested" || mode === "inherited") {
    if(mode === "inherited") dictDelete(field,"FT");
    entry = original.cos.allocateObject(cosDict({T:cosString("parent"),FT:cosName("Tx"),Q:cosNumber(2),DA:cosString("/Courier 9 Tf 1 0 0 rg"),Kids:cosArray([entry])}));
    if(mode === "inherited") dictSet(field,"Parent",entry);
  }
  if(mode !== "new") dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AcroForm", cosDict({Fields:cosArray(mode === "duplicate" ? [entry, cosDict({T:cosString("field"),FT:cosName("Tx")})] : [entry])}));
  const bytes = original.save(), expected = PdfDocument.load(bytes), name = (mode === "nested" || mode === "inherited") ? "parent.field" : "field", value = mode === "button-off" ? false : mode.startsWith("button") ? true : mode === "multi" ? "one,two" : "one";
  const updates = mode === "repeated" ? [{name,value}, {name:"new",value:false}, {name,value:"changed"}] : [{name,value}];
  for(const update of updates) setDocumentFormField(expected.cos,update.name,update.value);
  const fs=createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input",bytes); const storage={fs,directory:"/scratch"};
  const source=await PdfFileSource.open(fs,"/input"), document=await PdfRetainedDocument.open(source,storage);
  try {
    const edited=await editRetainedDocument(document,storage,{formUpdates:updates});
    try { const chunks=[]; for await(const chunk of saveRetainedDocumentChunks(edited.document,storage)) chunks.push(chunk); expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save()); }
    finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["producer", "cancel"])("cleans retained form updates after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const input = PdfDocument.create(); input.addPage(); await fs.writeFile("/input", input.save());
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  const controller = new AbortController(), reason = new Error("form producer failed");
  async function* updates() { yield {name:"first",value:"value"}; if(mode === "cancel") controller.abort(reason); else throw reason; yield {name:"last",value:true}; }
  try { await expect(editRetainedDocument(document, storage, {formUpdates:updates(),signal:controller.signal})).rejects.toBe(reason); }
  finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([32, 64])("streams %i generated updates through bounded caller writes", async count => {
  const fs=createMemoryFileSystem(); await fs.mkdir("/scratch"); const original=PdfDocument.create(); original.addPage();
  await fs.writeFile("/input",original.save()); let writes=0, outstanding=0;
  const guarded=new Proxy(fs,{get(owner,key){
    if(key === "readFile" || key === "writeFile") return () => {throw new Error("whole-file I/O forbidden");};
    if(key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle=await fs.open!(...args); return new Proxy(handle,{get(target,property){
        if(property === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => {
          expect(outstanding).toBe(0); expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536); writes++; outstanding+=args[0].length;
          try {await Promise.resolve(); return await handle.write!(...args);} finally {outstanding-=args[0].length;}
        };
        const value=Reflect.get(target,property); return typeof value === "function" ? value.bind(target) : value;
      }});
    };
    const value=Reflect.get(owner,key); return typeof value === "function" ? value.bind(owner) : value;
  }});
  const storage={fs:guarded,directory:"/scratch"},source=await PdfFileSource.open(guarded,"/input"),document=await PdfRetainedDocument.open(source,storage);
  async function* updates(){for(let index=0;index<count;index++) yield {name:"field",value:"generated value ".repeat(256)};}
  try {
    const edited=await editRetainedDocument(document,storage,{formUpdates:updates()});
    try {let size=0; for await(const chunk of saveRetainedDocumentChunks(edited.document,storage)){expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536);size+=chunk.length;await Promise.resolve();} expect(size).toBeGreaterThan(count*4096);}
    finally {await edited.close();}
  } finally {await document.close();await source.close();}
  expect(writes).toBeGreaterThan(count); expect(outstanding).toBe(0);expect(await fs.readdir("/scratch")).toEqual([]);
});
