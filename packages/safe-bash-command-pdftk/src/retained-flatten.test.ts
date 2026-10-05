import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PdfDocument,cosArray,cosDict,cosName,cosNumber,cosStream,cosString,dictSet} from "@poe-code/pdf-ast";
import {createCommandArguments} from "safe-bash-contracts";
import {createPdftkCommand,runPdftkCli} from "./index.js";

it.each(["flatten","output","fill_form","cat","shuffle","rotate","stamp","multistamp","background","multibackground","attach_files","update_info","update_info_utf8","burst"].flatMap(operation=>["text","appearance"].map(mode=>({operation,mode}))))("retains $operation $mode flatten semantics",async({operation,mode})=>{
 const doc=PdfDocument.create();for(let i=0;i<2;i++)doc.addPage([200,200]).drawText(`Page ${i}`,{x:20,y:150});
 const field=cosDict({T:cosString("name"),FT:cosName("Tx"),V:cosString("value"),Subtype:cosName("Widget"),Rect:cosArray([20,50,160,80].map(v=>cosNumber(v)))});
 if(mode==="appearance")dictSet(field,"AP",cosDict({N:doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 1 0 0 rg 0 0 100 20 re f Q\n"),{compress:true,dict:cosDict({BBox:cosArray([0,0,100,20].map(v=>cosNumber(v)))})}))}));
 const ref=doc.cos.allocateObject(field);dictSet(doc.getPage(0).pageDict,"Annots",cosArray([ref]));dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"AcroForm",cosDict({Fields:cosArray([ref])}));
 const overlay=PdfDocument.create();overlay.addPage([200,200]).drawText("Overlay",{x:50,y:100});
 const inputs=new Map([["in.pdf",doc.save()],["overlay.pdf",overlay.save()],["data",new TextEncoder().encode(operation==="fill_form"?"name=updated":"InfoBegin\nInfoKey: Title\nInfoValue: Updated")]]);
 const operands=operation==="fill_form"||operation.startsWith("update_info")||operation==="attach_files"?["data"]:operation.includes("stamp")||operation.includes("background")?["overlay.pdf"]:operation==="rotate"?["1right"]:[];
 const args=["in.pdf",operation,...operands,...(operation==="output"?["out.pdf"]:["output",operation==="burst"?"out-%d.pdf":"out.pdf"]),...(operation==="flatten"?[]:["flatten"]),...(mode==="appearance"?["compress","need_appearances"]:[])];
 const files=new Map(inputs),expected=await runPdftkCli(args,files),fs=createMemoryFileSystem();await fs.mkdir("/scratch");for(const[name,bytes]of inputs)await fs.writeFile(`/${name}`,bytes);
 const guarded=new Proxy(fs,{get(owner,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;}});
 const carrier=createCommandArguments(args);let stderr="";const result=await createPdftkCommand().execute({command:"pdftk",args:carrier.args,argumentValues:carrier,cwd:"/",env:{TMPDIR:"/scratch"},fs:guarded,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(){}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 expect(result.exitCode,stderr).toBe(expected.exitCode);expect(stderr).toBe(expected.stderr);for(const[name,bytes]of files)if(!inputs.has(name))expect(await fs.readFile(`/${name}`),name).toEqual(bytes);expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([[],["--help"],["--version"],["cat"]].map(argv=>({argv})))("handles $argv without filesystem input",async({argv})=>{
 const fs=createMemoryFileSystem();let reads=0;const guarded=new Proxy(fs,{get(owner,key){if(key==="readFile"||key==="openReadFile")return()=>{reads++;throw new Error("unexpected input read");};const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;}});
 const args=createCommandArguments(argv),expected=await runPdftkCli(argv,new Map());let stdout="",stderr="";
 const result=await createPdftkCommand().execute({command:"pdftk",args:args.args,argumentValues:args,cwd:"/",env:{},fs:guarded,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 expect(result.exitCode).toBe(expected.exitCode);expect(stdout).toBe(expected.stdout);expect(stderr).toBe(expected.stderr);expect(reads).toBe(0);
});
