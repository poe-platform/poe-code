import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
async function fixture(count = 3, maxTraversalStagingBytes = Infinity) {
  const original=PdfDocument.create();const pages=Array.from({length:count},()=>original.addPage());const root=original.cos.resolveDict(original.cos.rootRef)!;
  dictSet(root,"Dests",cosDict({legacy:cosArray([pages[count-1]!.ref,cosName("Fit")]),invalid:cosNumber(5)}));
  const pairs=[];for(let i=0;i<count;i++)pairs.push(cosString(`page${i+1}`),cosDict({D:cosArray([pages[i]!.ref,cosName("XYZ")])}));
  pairs.push(cosString("numeric"),cosArray([cosNumber(1),cosName("FitH")]),cosString("missing"),cosArray([cosNumber(-10)]));
  const tree=original.cos.allocateObject(cosDict({Names:cosArray(pairs)}));dictSet(original.cos.resolveDict(tree)!,"Kids",cosArray([tree]));dictSet(root,"Names",cosDict({Dests:tree}));
  const uri=original.cos.allocateObject(cosDict({URI:cosString("https://example.test/a")}));const next=original.cos.allocateObject(cosDict({URI:cosString("https://example.test/b")}));dictSet(original.cos.resolveDict(uri)!,"Next",cosArray([next,uri]));dictSet(pages[0]!.pageDict,"Annots",cosArray([cosDict({A:uri}),cosDict({A:uri})]));
  dictSet(pages[1]!.pageDict,"Annots",cosArray([cosDict({A:next})]));
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",original.save());const source=await PdfFileSource.open(fs,"/input");const document=await PdfRetainedDocument.open(source,{fs,directory:"/scratch"},{maxTraversalStagingBytes});
  return {document,fs,source,async close(){await document.close();await source.close();expect(await fs.readdir("/scratch")).toEqual([]);}};
}
it("streams legacy and name-tree destinations with backed page-reference lookup",async()=>{
  const f=await fixture();const rows=[];for await(const row of f.document.destinations())rows.push(row);
  expect(rows).toEqual([{name:"legacy",target:{pageNumber:3,kind:"Fit"}},{name:"invalid"},{name:"page1",target:{pageNumber:1,kind:"XYZ"}},{name:"page2",target:{pageNumber:2,kind:"XYZ"}},{name:"page3",target:{pageNumber:3,kind:"XYZ"}},{name:"numeric",target:{pageNumber:2,kind:"FitH"}},{name:"missing",target:{pageNumber:1,kind:"XYZ"}}]);await f.close();
});
it("closes suspended destination walks with a caller-backed page index",async()=>{
  const f=await fixture(150);const rows=f.document.destinations();expect((await rows.next()).value?.target?.pageNumber).toBe(150);await f.close();expect((await rows.next()).done).toBe(true);
});
it("deduplicates URL action cycles per annotation and selects pages",async()=>{
  const f=await fixture();const all=[];for await(const row of f.document.urls())all.push(row);
  expect(all).toEqual([{pageNumber:1,url:"https://example.test/a"},{pageNumber:1,url:"https://example.test/b"},{pageNumber:1,url:"https://example.test/a"},{pageNumber:1,url:"https://example.test/b"},{pageNumber:2,url:"https://example.test/b"}]);
  const selected=[];for await(const row of f.document.urls({firstPage:2,lastPage:2}))selected.push(row);expect(selected).toEqual([all[4]]);await f.close();
});

it("cleans destination indexes after traversal-budget rejection",async()=>{
  const f=await fixture(150,0);const baseline=await f.fs.readdir("/scratch");await expect(f.document.destinations().next()).rejects.toThrow("limit");expect(await f.fs.readdir("/scratch")).toEqual(baseline);await f.close();
});
it("validates URL page ranges before acquiring traversal storage",async()=>{
  const f=await fixture();const baseline=await f.fs.readdir("/scratch");for(const selection of [{firstPage:0},{firstPage:2,lastPage:1},{lastPage:NaN}])await expect(f.document.urls(selection).next()).rejects.toThrow("page range");expect(await f.fs.readdir("/scratch")).toEqual(baseline);await f.close();
});
it("closes suspended URL action walks with the document",async()=>{
  const f=await fixture();const rows=f.document.urls();expect((await rows.next()).value?.url).toBe("https://example.test/a");await f.close();expect((await rows.next()).done).toBe(true);
});
