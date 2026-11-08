import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const geometry of ["fallback", "positioned", "tiny"]) it(`retains PPTX PDF ${geometry} layout`, async () => {
  const positioned = geometry !== "fallback";
  const fs=new MemoryFileSystem(),encode=(value:string)=>new TextEncoder().encode(value);
  const title='<p:sp><a:p><a:t>Presentation title</a:t></a:p><a:p><a:t>Title subtitle</a:t></a:p></p:sp>';
  const body='<p:sp>'+(positioned?'<a:off x="914400" y="1828800"/><a:ext cx="5486400" cy="914400"/>':'')+'<a:p><a:rPr sz="2200"/><a:t>Body paragraph with enough words to wrap across a narrow text box.</a:t></a:p><a:p><a:t>Another paragraph</a:t></a:p></p:sp>';
  const extra=positioned?'<p:pic><a:off x="9144000" y="1828800"/><a:ext cx="914400" cy="914400"/><a:blip r:embed="pic"/></p:pic><p:graphicFrame><a:off x="914400" y="3657600"/><a:ext cx="5486400" cy="914400"/><a:tbl><a:tr><a:tc><a:t>Name</a:t></a:tc><a:tc><a:t>Value</a:t></a:tc></a:tr><a:tr><a:tc><a:t>A</a:t></a:tc><a:tc><a:t>120</a:t></a:tc></a:tr></a:tbl></p:graphicFrame>':'';
  const input=createStoredZipArchive({...geometry === 'tiny' ? {'ppt/presentation.xml':encode('<p:sldSz cx="100000000000000000000" cy="6858000"/>')} : {}, 'ppt/slides/slide1.xml':encode(title+body+extra),'ppt/slides/slide2.xml':encode('<p:sp><a:p><a:t>Second slide</a:t></a:p></p:sp>'),'ppt/slides/_rels/slide1.xml.rels':encode('<Relationship Id="pic" Target="../media/pic.png"/>'),'ppt/media/pic.png':encodePng({width:2,height:2,data:Uint8Array.of(255,0,0,255,0,255,0,128,0,0,255,255,255,255,0,255)})});
  await fs.writeFile('/input.pptx',input);
  const files=new Map([['/input.pptx',input]]),args=['--convert-to','pdf','/input.pptx'],expected=await runSofficeCli(args,files);
  const filesystem=new Proxy(fs,{get(target,key){if(key==='readFile'||key==='writeFile')return()=>{throw new Error('Whole-file I/O forbidden');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  let stdout='',stderr='';const result=await runSofficeFileCli(args,{filesystem,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual({...result,stdout,stderr},expected);
  const output=await fs.readFile('/input.pdf');
  if(geometry==='tiny')assert.equal(new TextDecoder().decode(output).includes('e-11'),false,'PDF coordinates must use decimal notation');
  const actual=PdfDocument.load(output),wanted=PdfDocument.load(files.get('/input.pdf')!);
  assert.equal(actual.pageCount,wanted.pageCount);assert.deepEqual(actual.getMetadata(),wanted.getMetadata());assert.equal(actual.extractText(),wanted.extractText());
  for(let page=0;page<actual.pageCount;page++)assert.deepEqual(actual.getPage(page).renderToPng({scale:0.5}),wanted.getPage(page).renderToPng({scale:0.5}));
});

for(const mode of ['empty','clipped','filtered'] as const)it(`preserves PPTX PDF ${mode} geometry and filters`,async()=>{
  const fs=new MemoryFileSystem(),encode=(value:string)=>new TextEncoder().encode(value),title='<sp><p><t>Title</t></p></sp>';
  const paragraphs=Array.from({length:35},(_,index)=>'<p><rPr sz="1800"/><t>Paragraph '+index+' with words</t></p>').join('');
  const table='<graphicFrame><off x="1000" y="5000"/><ext cx="8000" cy="1000"/><tbl>'+Array.from({length:20},()=>'<tr><tc><t>Cell</t></tc><tc><t>Two</t></tc></tr>').join('')+'</tbl></graphicFrame>';
  const input=createStoredZipArchive(mode==='empty'?{}:{'ppt/presentation.xml':encode('<p:sldSz cx="10000" cy="6000"/>'),'ppt/slides/slide1.xml':encode(title+'<sp><off x="1000" y="1000"/><ext cx="3000" cy="1000"/>'+paragraphs+'</sp><sp><off x="1050" y="2000"/><p><t>Same column</t></p></sp><sp><off x="6000" y="2000"/><p><t>Other column</t></p></sp>'+table),'ppt/slides/slide2.xml':encode(title)});
  await fs.writeFile('/input.pptx',input);const args=['--convert-to',mode==='filtered'?'pdf:impress_pdf_Export:{"PageRange":"2","SelectPdfVersion":15}':'pdf','/input.pptx'],files=new Map([['/input.pptx',input]]),expected=await runSofficeCli(args,files);
  const result=await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(){}},stderr:{async write(bytes){assert.fail(new TextDecoder().decode(bytes));}}});assert.equal(result.exitCode,expected.exitCode);
  const actual=PdfDocument.load(await fs.readFile('/input.pdf')),wanted=PdfDocument.load(files.get('/input.pdf')!);assert.equal(actual.pageCount,wanted.pageCount);assert.deepEqual(actual.getMetadata(),wanted.getMetadata());assert.equal(actual.cos.version,wanted.cos.version);assert.equal(actual.extractText(),wanted.extractText());for(let page=0;page<actual.pageCount;page++)assert.deepEqual(actual.getPage(page).renderToPng({scale:0.5}),wanted.getPage(page).renderToPng({scale:0.5}));
});
