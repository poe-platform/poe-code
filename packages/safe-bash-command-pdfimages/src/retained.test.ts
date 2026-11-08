import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosNumber, decodeJpegToRgba, decodePng, dictSet, encodePng, encodeJpeg, PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdfimagesCommand, runPdfimagesCli } from "./index.js";

it("matches the exact Poppler -list row for a 3x2 RGB image", async () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([216, 144]);
  const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]);
  page.drawImage(doc.embedRgbImage(3, 2, pixels), { x: 0, y: 0, width: 6, height: 4 });
  const input = doc.save();
  const result = await runPdfimagesCli(["-list", "in.pdf"], new Map([["in.pdf", input]]));
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n"
      + "--------------------------------------------------------------------------------------------\n"
      + "   1     0 image       3     2  rgb     3   8  image  no         6  0    36    36   19B 106%\n",
  });
  await compareCommand(input, ["-list"]);
});

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
  return { stdout, fs };
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
  const extension = filter === "DCTDecode" ? "jpg" : filter === "JPXDecode" ? "jp2" : filter === "JBIG2Decode" ? "jb2e" : "ccitt";
  const nativeFlag = filter === "DCTDecode" ? "-j" : filter === "JPXDecode" ? "-jp2" : filter === "JBIG2Decode" ? "-jbig2" : "-ccitt";
  for (const flag of ["-all", nativeFlag]) {
    const { stdout, fs } = await compareCommand(input,[flag,"-p","-print-filenames","-upw","secret"]);
    expect(stdout).toBe(`out-001-000.${extension}\n`);
    expect(await fs.readFile(`/out-001-000.${extension}`)).toEqual(bytes);
    if (filter === "JBIG2Decode") expect(await fs.readFile("/out-001-000.jb2g")).toEqual(fixture("jbig2-symbols.sym"));
    if (filter === "CCITTFaxDecode") expect(new TextDecoder().decode(await fs.readFile("/out-001-000.params"))).toBe("-4 -x 8 -y 2\n");
  }
  await compareCommand(input,["-list","-upw","secret"]);
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

it.each([["-png"], ["-list"], ["-u", "-png"]].map(flags => ({ flags })))("extracts painted shared resources through the command: $flags", async ({ flags }) => {
  const { readFileSync } = await import("node:fs");
  await compareCommand(new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url))), flags);
});

it.each([[200, 100], [1, 1], [1, 4], [4, 1]])("honors PDF JPEG dimensions %sx%s in both command paths", async (width, height) => {
  const jpeg = encodeJpeg({ width: 2, height: 2, data: new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255]) });
  const doc = PdfDocument.create();
  const image = doc.embedJpg(jpeg);
  const stream = doc.cos.resolve(image.xobjectRef);
  if (stream?.kind !== "stream") throw new Error("Missing image");
  dictSet(stream.dict, "Width", cosNumber(width));
  dictSet(stream.dict, "Height", cosNumber(height));
  doc.addPage([200, 100]).drawImage(image, { x: 0, y: 0, width: 200, height: 100 });
  const input = doc.save();
  const files = new Map([["in.pdf", input]]);
  expect((await runPdfimagesCli(["-png", "in.pdf", "out"], files)).exitCode).toBe(0);
  const bitmap = decodePng(files.get("out-000.png")!);
  expect([bitmap.width, bitmap.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4).fill(255);
  expected.set(decodeJpegToRgba(jpeg).data.subarray(0, expected.length));
  expect(bitmap.data).toEqual(expected);
  const listing = await runPdfimagesCli(["-list", "in.pdf"], files);
  expect(listing.stdout.trimEnd().split("\n")[2]!.trim().split(/\s+/).slice(3, 5)).toEqual([String(width), String(height)]);
  for (const flags of [["-png"], ["-list"], ["-j"]]) await compareCommand(input, flags);
});

it("uses dictionary dimensions for the checked-in PDF.js JPEG fixture", async () => {
  const { readFileSync } = await import("node:fs");
  const input = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-xobject-image.pdf", import.meta.url)));
  const files = new Map([["in.pdf", input]]);
  expect((await runPdfimagesCli(["-png", "in.pdf", "out"], files)).exitCode).toBe(0);
  const bitmap = decodePng(files.get("out-000.png")!);
  expect([bitmap.width, bitmap.height]).toEqual([200, 100]);
  expect([...bitmap.data.slice(4, 12)]).toEqual(new Array(8).fill(255));
  const listing = await runPdfimagesCli(["-list", "in.pdf"], files);
  expect(listing.stdout.split("\n")[2]).toContain("   1     0 image     200   100  rgb     3   8  jpeg   no         4  0    29    18  580B");
  for (const flags of [["-png"], ["-list"]]) await compareCommand(input, flags);
});

it("extracts numbered soft masks on selected pages in both paths", async () => {
  const doc = PdfDocument.create();
  const image = doc.embedPng(encodePng({width:2,height:2,data:new Uint8Array([255,10,20,128,10,250,30,64,20,30,240,255,255,255,0,0])}));
  for (let page = 0; page < 2; page++) doc.addPage([100,100]).drawImage(image,{x:10,y:10,width:50,height:50});
  const input = doc.save();
  const files = new Map([["in.pdf",input]]);
  const result = await runPdfimagesCli(["-list","-f","2","-l","2","in.pdf"], files);
  // Poppler 26.08.0 reports the parent object ID for both rows.
  expect(result.stdout.split("\n").slice(2)).toEqual([
    "   2     0 image       2     2  rgb     3   8  image  no         5  0     3     3   20B 167%",
    "   2     1 smask       2     2  gray    1   8  image  no         5  0     3     3   12B 300%",
    "",
  ]);
  const extracted = await runPdfimagesCli(["-f","2","-l","2","-p","-png","-print-filenames","in.pdf","out"], files);
  expect(extracted.stdout).toBe("out-002-000.png\nout-002-001.png\n");
  const unique = new Map([["in.pdf",input]]);
  await runPdfimagesCli(["-u","-png","in.pdf","out"], unique);
  expect([...unique.keys()]).toEqual(["in.pdf","out-000.png","out-001.png"]);
  for (const flags of [["-list"],["-png"],["-u","-png"],["-f","2","-l","2","-list"],["-f","2","-l","2","-p","-png","-print-filenames"]]) await compareCommand(input,flags);
});
