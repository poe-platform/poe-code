import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createStoredZipArchive, readZipArchiveEntries, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const format of ['cat','txt','html','docx']) it(`retains PPTX ${format} slide ordering, shapes, and tables`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), fs = new MemoryFileSystem();
  const input = createStoredZipArchive({
    'ppt/slides/slide0002.xml': encode('<p:sp><a:p><a:t>' + 'x'.repeat(4095) + '😀' + '😀'.repeat(9000) + '</a:t></a:p></p:sp>'),
    'ppt/slides/slide10.xml': encode('<p:sp><a:p><a:t> Ten </a:t></a:p><a:p><a:t>One &amp; two</a:t></a:p></p:sp>'),
    'ppt/slides/slide2.xml': encode('<p:sp><a:p><a:t> </a:t></a:p></p:sp><p:sp><a:p><a:t>Ti</a:t><a:t>tle</a:t></a:p></p:sp><p:sp><a:p><a:t>Bullet</a:t></a:p><a:p><a:t>Second</a:t></a:p></p:sp><p:graphicFrame><a:tbl><a:tr><a:tc><a:t>A</a:t></a:tc><a:tc><a:t> B </a:t></a:tc></a:tr></a:tbl></p:graphicFrame>'),
    'ppt/slides/slide1.xml': encode('<p:sp><a:p><a:t> </a:t></a:p></p:sp>'),
    'ppt/slides/slide3.xml': encode('<p:sp><a:p><a:t>Standalone</a:t></a:p></p:sp>'),
    'ppt/slides/not-a-slide.xml': encode('<p:sp><a:p><a:t>Ignored</a:t></a:p></p:sp>')
  });
  await fs.writeFile('/input.pptx',input);
  const args = format === 'cat' ? ['--cat','/input.pptx'] : ['--convert-to',format,'/input.pptx'];
  const files = new Map([['/input.pptx',input]]), expected = await runSofficeCli(args,files);
  const filesystem = new Proxy(fs,{get(target,key){
    if (key === 'readFile' || key === 'writeFile') return () => {throw new Error('Whole-file I/O forbidden');};
    const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  let stdout='',stderr='';
  const result = await runSofficeFileCli(args,{filesystem,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual({...result,stdout,stderr},expected);
  if (format !== 'cat') {
    const actual = await fs.readFile('/input.'+format), wanted = files.get('/input.'+format)!;
    assert.deepEqual(format === 'docx' ? readZipArchiveEntries(actual) : actual,format === 'docx' ? readZipArchiveEntries(wanted) : wanted);
  }
});

for (const empty of [false,true]) it(`preserves PPTX ${empty ? 'empty archive' : 'duplicate slide replacement'} semantics`, async () => {
  const encode=(text:string)=>new TextEncoder().encode(text),fs=new MemoryFileSystem();
  const input=createStoredZipArchive(empty?{}:{'ppt/slides/slide1.xml':encode('<sp><p><t>Original</t></p></sp>'),'ppt/slides/slide2.xml':encode('<sp><p><t>Replacement</t></p></sp>')});
  const name=encode('slide2.xml');
  for(let offset=0;offset+name.length<=input.length;offset++)if(name.every((byte,index)=>input[offset+index]===byte))input[offset+5]=49;
  await fs.writeFile('/input.pptx',input);
  for(const format of ['cat','txt','html','docx']){
    const args=format==='cat'?['--cat','/input.pptx']:['--convert-to',format,'/input.pptx'],files=new Map([['/input.pptx',input]]),expected=await runSofficeCli(args,files);let stdout='',stderr='';
    const actual=await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
    assert.deepEqual({...actual,stdout,stderr},expected);
    if(format!=='cat'){const got=await fs.readFile('/input.'+format),wanted=files.get('/input.'+format)!;assert.deepEqual(format==='docx'?readZipArchiveEntries(got):got,format==='docx'?readZipArchiveEntries(wanted):wanted);}
  }
});
