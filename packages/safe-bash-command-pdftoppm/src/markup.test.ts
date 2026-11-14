import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, dictSet, decodePng } from "@poe-code/pdf-ast";
import { createPdftoppmCommand, createPdftocairoCommand, runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync } from "./index.js";
// PDFium controls, except /CA null: MuPDF confirms the specified default opacity
// of one. The supplied-appearance control uses explicit /CA 1 on that page.
const pdf = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-markup.pdf", import.meta.url)));
const samples = readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-markup.samples", import.meta.url), "utf8").trim().split("\n").map(row => row.split(" ").map(Number));
for (const run of [runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync]) {
  it(`${run.name} renders markup without appearance streams against independent renderers`, async () => {
    const files = new Map([["input.pdf", pdf]]);
    const result = await run(["-png", "-r", "72", "input.pdf", "page"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    const pages = [...files.entries()].filter(([name]) => name.startsWith("page-")).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, bytes]) => decodePng(bytes));
    expect(pages).toHaveLength(32);
    for (const [page, x, y, ...rgb] of samples) {
      const image = pages[page! - 1]!;
      expect([image.width, image.height]).toEqual([100, 100]);
      const actual = image.data.subarray((y! * 100 + x!) * 4, (y! * 100 + x!) * 4 + 3);
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[channel]! - rgb[channel]!), `page ${page}, ${x},${y}: ${actual} vs ${rgb}`).toBeLessThanOrEqual(2);
    }
    // PDFium's independently synthesized appearance streams must paint the same
    // geometry, including thin strokes and transparency, in this rasterizer.
    const control = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-markup-appearances.pdf", import.meta.url)));
    const reference = new Map([["control.pdf", control]]);
    expect((await run(["-png","-r","72","control.pdf","reference"],reference)).exitCode).toBe(0);
    const refs=[...reference.entries()].filter(([name])=>name.startsWith("reference-")).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([,bytes])=>decodePng(bytes));
    for(let page=0;page<pages.length;page++) {
      let worst=0,changed=0;
      for(let at=0;at<pages[page]!.data.length;at++) {const error=Math.abs(pages[page]!.data[at]!-refs[page]!.data[at]!);worst=Math.max(worst,error);if(error>2)changed++;}
      expect(worst,`page ${page+1}: ${changed} channels differ from synthesized PDFium streams`).toBeLessThanOrEqual(2);
    }
    expect(files.get("input.pdf")).toEqual(pdf);
  });
}


for (const command of ["pdftoppm","pdftocairo"] as const) it(`${command} retains synthesized markup and hides it on request`, async()=>{
  const fs=createMemoryFileSystem();await fs.mkdir("/tmp");await fs.writeFile("/input.pdf",pdf);
  const run=command==="pdftoppm" ? createPdftoppmCommand() : createPdftocairoCommand();
  for(const hide of [false,true]) {
    const args=createCommandArguments([...(hide?["-hide-annotations"]:[]),"-png","-r","72","input.pdf","page"]);
    let stderr="";
    const result=await run.execute({command,args:args.args,argumentValues:args,cwd:"/",env:{},fs,stdin:(async function*(){})(),signal:new AbortController().signal,stdout:{write:async()=>{}},stderr:{write:async s=>{stderr+=s;}}});
    expect(result.exitCode,stderr).toBe(0);
    const expectedFiles=new Map([["input.pdf",pdf]]);
    expect((await runPdftoppmCliSync([...(hide?["-hide-annotations"]:[]),"-png","-r","72","input.pdf","page"],expectedFiles)).exitCode).toBe(0);
    for(const [name,expected] of expectedFiles) if(name.startsWith("page-")) {
      const a=decodePng(await fs.readFile(`/${name}`)),b=decodePng(expected);
      expect([a.width,a.height]).toEqual([b.width,b.height]);
      let worst=0;for(let i=0;i<a.data.length;i++) worst=Math.max(worst,Math.abs(a.data[i]!-b.data[i]!));
      expect(worst,`${command} ${name} hidden=${hide}`).toBeLessThanOrEqual(2);
    }
    expect(await fs.readFile("/input.pdf")).toEqual(pdf);
  }
});

it("rejects malformed and excessive generated markup in both TypeScript CLI forms",async()=>{
  const numbers=(v:number[])=>cosArray(v.map(n=>cosNumber(n)));
  const cases=[
    {Subtype:cosName("Highlight"),QuadPoints:numbers([1,2,3])},
    {Subtype:cosName("Ink"),InkList:cosArray([numbers([1,2,3])])},
    {Subtype:cosName("Square"),C:numbers([1,2])},
    {Subtype:cosName("Square"),CA:cosName("invalid")},
    {Subtype:cosName("Squiggly"),QuadPoints:numbers([0,10,1e9,10,0,0,1e9,0])},
    {Subtype:cosName("Ink"),InkList:cosArray([numbers(Array(65536).fill(1))])},
  ];
  for(const extra of cases) {
    const doc=PdfDocument.create(),page=doc.addPage([100,100]);
    dictSet(page.pageDict,"Annots",cosArray([cosDict({Rect:numbers([0,0,100,100]),...extra})]));
    const source=doc.save();
    for(const run of [runPdftoppmCli,runPdftoppmCliSync]) {
      const files=new Map([["in.pdf",source]]);
      await expect(Promise.resolve().then(()=>run(["-png","-r","72","in.pdf","out"],files))).rejects.toThrow(/PDF (markup|ink)/);
      expect(files.get("in.pdf")).toEqual(source);
      expect([...files.keys()]).toEqual(["in.pdf"]);
      expect((await run(["-hide-annotations","-png","-r","72","in.pdf","out"],files)).exitCode).toBe(0);
    }
  }
});
