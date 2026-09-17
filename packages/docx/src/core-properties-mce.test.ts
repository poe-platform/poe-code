import {Volume} from "memfs";
import {expect,it} from "vitest";
import {MemoryFileSystem,Shell} from "virtual-bash";
import {docxCommands} from "virtual-bash/commands/docx";
import {Document,inspectDocument,readDocumentArchive,replaceDocumentXmlPart,createDocxInspectionCommandEngine,writeArchive} from "./index.js";
import {chartFixture,chartContext} from "../tests/fixtures/charts.js";
import {readPackage} from "../tests/assertions.js";
const cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties",dc="http://purl.org/dc/elements/1.1/",mc="http://schemas.openxmlformats.org/markup-compatibility/2006";
for(const strict of[false,true])for(const kind of["docx","dotx"] as const)for(const native of[false,true])
for(const carrier of["namespace-only","ignorable","must-understand","process","preserve-elements","preserve-attributes","choice","fallback","inner","inactive","opaque"] as const)
for(const route of["model","archive","inspect","replace","shell"] as const)
it(route+" enforces core MCE prohibition for "+carrier+" native="+native+"; "+kind+" strict="+strict,async()=>{
 const enc=(s:string)=>new TextEncoder().encode(s),dec=(b:Uint8Array)=>new TextDecoder().decode(b),title="<dc:title>Coast</dc:title>",alternate='<x:AlternateContent><x:Choice Requires="'+(carrier==="fallback"?"f":"dc")+'">'+title+"</x:Choice><x:Fallback>"+title+"</x:Fallback></x:AlternateContent>";
 const extra=carrier==="ignorable"?' x:Ignorable="f"':carrier==="must-understand"?' x:MustUnderstand="dc"':carrier==="process"?' x:Ignorable="f" x:ProcessContent="f:bridge"':carrier==="preserve-elements"?' x:Ignorable="f" x:PreserveElements="f:*"':carrier==="preserve-attributes"?' x:Ignorable="f" x:PreserveAttributes="f:*"':"";
 const body=carrier==="choice"||carrier==="fallback"?alternate:carrier==="inner"?"<dc:title>"+alternate+"</dc:title>":carrier==="inactive"?'<f:ignored x:Ignorable="f"><x:AlternateContent><x:Choice Requires="dc">'+title+"</x:Choice></x:AlternateContent></f:ignored>"+title:carrier==="opaque"?'<f:opaque><dc:title x:MustUnderstand="dc">Coast</dc:title></f:opaque>':carrier==="process"?"<f:bridge>"+title+"</f:bridge>":title;
 const xml='<cp:coreProperties xmlns:cp="'+cp+'" xmlns:dc="'+dc+'" xmlns:x="'+mc+'" xmlns:f="urn:original:future"'+extra+">"+body+"</cp:coreProperties>";
 const parts=readPackage(await chartFixture({strict,definitions:[],body:"<w:p><w:r><w:t>Body</w:t></w:r></w:p>",resources:[{name:"metadata/core.xml",type:native?"application/vnd.openxmlformats-package.core-properties+xml":"application/xml",bytes:xml}],relationships:native?[{owner:"/",id:"core",type:"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",target:"metadata/core.xml"}]:[]}));
 parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml","wordprocessingml."+(kind==="dotx"?"template":"document")+".main+xml")));
 const memory=Volume.fromJSON({"/input":"","/output":""});await writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},chartContext);const input=new Uint8Array(memory.readFileSync("/input") as Buffer),rejected=native&&carrier!=="namespace-only";
 if(route==="shell"){const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/replacement",enc(xml));const shell=new Shell({fs}).use(docxCommands({engine:createDocxInspectionCommandEngine({limits:chartContext.limits})}));for(const cmd of["docx inspect /input --json","docx xml set /input --part /metadata/core.xml --file /replacement --dry-run --json"]){const result=await shell.exec(cmd);expect(result.exitCode,result.stdout+result.stderr).toBe(rejected?1:0);const response=JSON.parse(result.stdout);expect(response.ok).toBe(!rejected);if(rejected)expect(response.errors[0].code).toBe("invalid-package");}expect(await fs.readFile("/input")).toEqual(input);}
 else{const pending=route==="model"?Document(input,chartContext):route==="archive"?readDocumentArchive(input,chartContext):route==="inspect"?inspectDocument(input,chartContext):replaceDocumentXmlPart(input,enc(xml),{part:"/metadata/core.xml",dryRun:true},{...chartContext,encoding:{order:"input",compression:"store"}});if(rejected)await expect(pending).rejects.toMatchObject({code:"invalid-package"});else await pending;}
 expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));expect(memory.readFileSync("/output").length).toBe(0);
});

