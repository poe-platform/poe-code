import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

it.each(["text","xfdf","fdf","report","stdin","empty","missing","new","widgets","duplicate","encrypted","compress","uncompress","font","appearances"])("fills %s forms with retained input and exact output bytes",async mode=>{
  const doc=PdfDocument.create(),page=doc.addPage([300,200]);
  const field=cosDict({T:cosString("name"),FT:cosName("Tx"),Subtype:cosName("Widget"),Rect:cosArray([20,50,200,80].map(v=>cosNumber(v)))});
  if(mode==="widgets")dictSet(field,"Kids",cosArray([cosDict({Subtype:cosName("Widget"),Rect:cosArray([20,90,200,120].map(v=>cosNumber(v)))})]));
  const ref=doc.cos.allocateObject(field);dictSet(page.pageDict,"Annots",cosArray([ref]));
  if(mode!=="new")dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"AcroForm",cosDict({Fields:cosArray([ref])}));
  const input=doc.save(mode==="encrypted"?{encrypt:{userPassword:"secret",ownerPassword:"owner"}}:{});
  const text=mode==="empty"?"":mode==="xfdf"?'<xfdf><fields><field name="name"><value>one</value><value>two</value></field></fields></xfdf>':mode==="fdf"?'%FDF-1.2\n1 0 obj << /FDF << /Fields [<< /T (name) /V (value) >>] >> >> endobj':mode==="report"?'FieldName: name\nFieldValue: value':mode==="duplicate"?'name=first\nother=Yes\nname=last':'name=value';
  const data=new TextEncoder().encode(text),args=["in.pdf",...(mode==="encrypted"?["input_pw","secret"]:[]),"fill_form",mode==="stdin"?"-":"data","output","out.pdf",...(mode==="font"?["replacement_font","/Courier"]:mode==="appearances"?["need_appearances"]:mode==="compress"||mode==="uncompress"?[mode]:[])];
  const files=new Map([["in.pdf",input],["-",data]]);if(mode!=="missing")files.set("data",data);const expected=await runPdftkCli(args,files);
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/in.pdf",input);if(mode!=="missing")await fs.writeFile("/data",data);
  const guarded=new Proxy(fs,{get(owner,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;}});
  const carrier=createCommandArguments(args);let stderr="";
  const result=await createPdftkCommand({limits:{maxInputBytes:input.length+data.length}}).execute({command:"pdftk",args:carrier.args,argumentValues:carrier,cwd:"/",env:{TMPDIR:"/scratch"},fs:guarded,signal:new AbortController().signal,stdin:(async function*(){const buffer=new Uint8Array(7);for(let offset=0;offset<data.length;offset+=buffer.length){const length=Math.min(buffer.length,data.length-offset);buffer.set(data.subarray(offset,offset+length));yield buffer.subarray(0,length);}})(),stdout:{async write(){}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  expect(result.exitCode,stderr).toBe(expected.exitCode);expect(stderr).toBe(expected.stderr);if(files.has("out.pdf"))expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf"));expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["write","cancel"])("preserves destination and cleans form backing after %s failure",async mode=>{
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");const doc=PdfDocument.create();doc.addPage();await fs.writeFile("/in.pdf",doc.save());await fs.writeFile("/data",new TextEncoder().encode("field=value"));await fs.writeFile("/out.pdf",Uint8Array.of(7));
  const reason=new Error("form publication failed"),controller=new AbortController();
  const guarded=new Proxy(fs,{get(owner,key){
    if(key==="createStagedFile")return async(...args:Parameters<NonNullable<typeof fs.createStagedFile>>)=>{const file=await fs.createStagedFile!(...args);return {...file,writer:{...file.writer!,async write(){if(mode==="cancel")controller.abort(reason);throw reason;}}};};
    const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;
  }});
  const args=createCommandArguments(["in.pdf","fill_form","data","output","out.pdf"]);
  await expect(createPdftkCommand().execute({command:"pdftk",args:args.args,argumentValues:args,cwd:"/",env:{TMPDIR:"/scratch"},fs:guarded,signal:controller.signal,stdin:(async function*(){})(),stdout:{async write(){}},stderr:{async write(){}}})).rejects.toBe(reason);
  expect(await fs.readFile("/out.pdf")).toEqual(Uint8Array.of(7));expect(await fs.readdir("/scratch")).toEqual([]);
});
