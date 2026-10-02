import {Volume} from "memfs";
import {expect,it} from "vitest";
import {MemoryFileSystem,Shell} from "@poe-platform/safe-bash";
import {docxCommands} from "@poe-platform/safe-bash/commands/docx";
import {Document,createDocxInspectionCommandEngine,inspectDocumentObjects,writeArchive} from "./index.js";
import {chartFixture,chartContext} from "../tests/fixtures/charts.js";
import {readPackage} from "../tests/assertions.js";
const variants=[
 {type:"application/vnd.openxmlformats-officedocument.oleObject",ole:true,macro:false},
 {type:'APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.OLEOBJECT; audit="macroEnabled"',ole:true,macro:false},
 {type:"application/x-oleObject",ole:false,macro:false},
 {type:"application/vnd.openxmlformats-officedocument.oleObject-backup",ole:false,macro:false},
 {type:"application/vnd.ms-excel.sheet.macroEnabled.12-backup",ole:false,macro:false},
 {type:'application/x-macroEnabled; audit="oleObject"',ole:false,macro:false},
 {type:"application/octet-stream;note=macroEnabled",ole:false,macro:false},
 ...["excel.sheet","excel.template","excel.sheet.binary","excel.addin","powerpoint.presentation","powerpoint.slideshow","powerpoint.template","powerpoint.addin","word.document","word.template"].map(name=>({type:"application/vnd.ms-"+name+".macroEnabled.12",ole:false,macro:true}))
];
for(const strict of[false,true])for(const kind of["docx","dotx"] as const)for(const mode of["orphan","folder","package","ole"] as const)for(const route of["sdk","shell"] as const)for(const variant of variants)
it(route+" classifies object MIME "+variant.type+"; "+mode+" "+kind+" strict="+strict,async()=>{
 const enc=(s:string)=>new TextEncoder().encode(s),dec=(b:Uint8Array)=>new TextDecoder().decode(b),r=strict?"http://purl.oclc.org/ooxml/officeDocument/relationships":"http://schemas.openxmlformats.org/officeDocument/2006/relationships",name=mode==="folder"?"word/embeddings/original.bin":"assets/original.bin",payload=Uint8Array.of(7,11,19,31,0,255),bound=mode==="package"||mode==="ole";
 const parts=readPackage(await chartFixture({strict,definitions:[],body:"<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>",resources:[{name,type:variant.type,bytes:payload}],relationships:bound?[{owner:"/word/document.xml",id:"object",type:r+"/"+(mode==="ole"?"oleObject":"package"),target:"../"+name}]:[]}));
 parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml","wordprocessingml."+(kind==="dotx"?"template":"document")+".main+xml")));
 const memory=Volume.fromJSON({"/input":"","/output":""});await writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},chartContext);const input=new Uint8Array(memory.readFileSync("/input") as Buffer);
 let data;if(route==="sdk")data=await inspectDocumentObjects(input,{},chartContext);else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);const result=await new Shell({fs}).use(docxCommands({engine:createDocxInspectionCommandEngine({limits:chartContext.limits})})).exec("docx objects list /input --json");expect(result.exitCode,result.stderr).toBe(0);data=JSON.parse(result.stdout).data;expect(await fs.readFile("/input")).toEqual(input);}
 const expected=mode!=="orphan"||variant.ole;expect(data.items).toHaveLength(expected?1:0);if(expected)expect(data.items[0].details).toMatchObject({role:bound?(mode==="ole"?"ole":"package"):variant.ole?"ole":"unknown",security:{macro:variant.macro?"declared":"unknown",protected:"unknown",content:"opaque"},resource:{part:"/"+name,contentType:variant.type,bytes:payload.length}});
 const model=await Document(input,chartContext);await model.save({async write(bytes){memory.appendFileSync("/output",bytes);}});expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

