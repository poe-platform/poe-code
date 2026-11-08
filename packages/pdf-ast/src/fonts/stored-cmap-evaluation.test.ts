import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfDocument} from "../document.js";
import {PdfRetainedDocument} from "../retained-document.js";
import {PdfFileSource} from "../source.js";
import {cosArray,cosDict,cosName,cosNumber,cosStream,dictSet} from "../ast.js";

it.each(['Type1','TrueType','Type3','Type0','mixed'])('preserves retained %s glyphs, widths, spaces and character boundaries',async mode=>{
 const original=PdfDocument.create(),page=original.addPage([200,100]);
 const unicode=original.cos.allocateObject(cosStream(new TextEncoder().encode('begincodespacerange <0000> <ffff> endcodespacerange beginbfchar <41> <00660069> <20> <0020> <42> <D83DDE00> <8001> <03a9> endbfchar')));
 const encoding=original.cos.allocateObject(cosStream(new TextEncoder().encode('begincodespacerange <20> <7f> <8000> <80ff> endcodespacerange begincidchar <41> 65 <20> 32 <42> 66 <8001> 65 endcidchar')));
 const font=cosDict({Subtype:cosName(mode==='mixed'?'Type0':mode),BaseFont:cosName('Helvetica'),ToUnicode:unicode,Encoding:mode==='mixed'?encoding:cosName('WinAnsiEncoding'),FirstChar:cosNumber(32),Widths:cosArray(Array.from({length:35},()=>cosNumber(600)))});
 dictSet(page.pageDict,'Resources',cosDict({Font:cosDict({F:original.cos.allocateObject(font)})}));
 page.setRawContentStream(mode==='Type0'?'BT /F 10 Tf 5 Tw 10 30 Td <00410020004200> Tj ET':mode==='mixed'?'BT /F 10 Tf 5 Tw 10 30 Td <412042800180> Tj ET':'BT /F 10 Tf 5 Tw 10 30 Td [(A) ( B)] TJ ET');
 const bytes=original.save(),expected=PdfDocument.load(bytes).getPage(0).evaluateDisplayList().glyphs;
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');await fs.writeFile('/input',bytes);
 const source=await PdfFileSource.open(fs,'/input'),document=await PdfRetainedDocument.open(source,{fs,directory:'/scratch'});
 const storage=new PagedStorage({fs,cwd:'/scratch',env:{},signal:new AbortController().signal},2);
 try{const retained=(await document.pages().next()).value!,actual=[];
 for await(const event of retained.evaluateSteps({fs,directory:"/scratch"},{pathStorage:storage})){if(event.operation.kind==='glyph')actual.push(event.operation.value);}
 expect(actual.map(({unicode,matrix})=>({unicode,matrix}))).toEqual(expected.map(({unicode,matrix})=>({unicode,matrix})));
 }finally{await storage.close();await document.close();await source.close();expect(await fs.readdir('/scratch')).toEqual([]);}
});
