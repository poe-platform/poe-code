import {Volume} from "memfs";
import {expect,it} from "vitest";
import {Shell,MemoryFileSystem} from "virtual-bash";
import {docxCommands} from "virtual-bash/commands/docx";
import {Document,inspectDocument,createDocxInspectionCommandEngine,writeArchive} from "./index.js";
import {chartFixture,chartContext} from "../tests/fixtures/charts.js";
import {readPackage} from "../tests/assertions.js";
for(const strict of[false,true])for(const kind of["docx","dotx"] as const)for(const native of[false,true])for(const fontMime of["application/vnd.openxmlformats-officedocument.obfuscatedFont;note=coast","application/x-fontdata","application/x-notafont","application/vnd.openxmlformats-officedocument.obfuscatedFont-backup"] as const)for(const route of["sdk","shell"] as const)
it(route+" recognizes declared font resources native="+native+" binary="+fontMime+"; "+kind+" strict="+strict,async()=>{
 const enc=(s:string)=>new TextEncoder().encode(s),dec=(b:Uint8Array)=>new TextDecoder().decode(b),w=strict?"http://purl.oclc.org/ooxml/wordprocessingml/main":"http://schemas.openxmlformats.org/wordprocessingml/2006/main",r=strict?"http://purl.oclc.org/ooxml/officeDocument/relationships":"http://schemas.openxmlformats.org/officeDocument/2006/relationships",a=strict?"http://purl.oclc.org/ooxml/drawingml/main":"http://schemas.openxmlformats.org/drawingml/2006/main";
 const type=(suffix:string)=>native?"application/vnd.openxmlformats-officedocument."+suffix+"+xml;audit=coast":"application/xml";
 const parts=readPackage(await chartFixture({strict,definitions:[],body:"<w:p><w:r><w:t>Body</w:t></w:r></w:p>",resources:[
 {name:"data/theme.xml",type:type("theme"),bytes:'<a:theme xmlns:a="'+a+'" name="Coast"><a:themeElements><a:fontScheme name="Coast"><a:majorFont><a:latin typeface="Coast Theme"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>'},
 {name:"data/fonts.xml",type:type("wordprocessingml.fontTable"),bytes:'<w:fonts xmlns:w="'+w+'"><w:font w:name="Coast Serif"/></w:fonts>'},
 {name:"data/settings.xml",type:type("wordprocessingml.settings"),bytes:'<w:settings xmlns:w="'+w+'"><w:themeFontLang w:val="en-US"/><w:clrSchemeMapping w:t1="accent1"/></w:settings>'},
 {name:"data/styles.xml",type:type("wordprocessingml.styles"),bytes:'<w:styles xmlns:w="'+w+'"><w:style w:styleId="Coast" w:type="paragraph"><w:name w:val="Coast"/><w:rPr><w:rFonts w:ascii="Coast Style" w:asciiTheme="majorAscii"/></w:rPr></w:style></w:styles>'},
 {name:"data/font.bin",type:fontMime,bytes:Uint8Array.of(7,13,19,0,255)}],relationships:native?["theme","fontTable","settings","styles"].map((name,i)=>({owner:"/word/document.xml",id:"data"+i,type:r+"/"+name,target:"../data/"+["theme","fonts","settings","styles"][i]+".xml"})):[]}));
 parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml","wordprocessingml."+(kind==="dotx"?"template":"document")+".main+xml")));
 const memory=Volume.fromJSON({"/input":"","/output":""});await writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},chartContext);const input=new Uint8Array(memory.readFileSync("/input") as Buffer);
 let data;if(route==="sdk")data=await inspectDocument(input,chartContext);else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);const result=await new Shell({fs}).use(docxCommands({engine:createDocxInspectionCommandEngine({limits:chartContext.limits})})).exec("docx inspect /input --json");expect(result.exitCode,result.stderr).toBe(0);data=JSON.parse(result.stdout).data;expect(await fs.readFile("/input")).toEqual(input);}
 expect(data.fonts.references).toEqual(native?["Coast Serif","Coast Style","Coast Theme"]:[]);expect(data.fonts.themeReferences).toEqual(native?["majorAscii"]:[]);expect(data.fonts.embedded).toEqual(fontMime==="application/x-fontdata"||fontMime.endsWith(";note=coast")?["/data/font.bin"]:[]);
 const resources=data.fontResources;expect(resources.themes).toHaveLength(native?1:0);expect(resources.fontTables).toHaveLength(native?1:0);expect(resources.languages).toEqual(native?[{part:"/data/settings.xml",values:{val:"en-US"}}]:[]);expect(resources.colorMappings).toEqual(native?[{part:"/data/settings.xml",values:{t1:"accent1"}}]:[]);expect(resources.references).toHaveLength(native?1:0);if(native)expect(resources.references[0]).toMatchObject({part:"/data/styles.xml",value:"majorAscii",status:"resolved"});
 const model=await Document(input,chartContext);await model.save({async write(bytes){memory.appendFileSync("/output",bytes);}});expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

