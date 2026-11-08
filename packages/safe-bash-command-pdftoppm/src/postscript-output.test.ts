import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {PdfDocument,cosStream,dictSet} from '@poe-code/pdf-ast';
import {runPdftocairoCli,runPdftocairoCliSync} from './index.js';

function vectorPage(){
 const doc=PdfDocument.create(),page=doc.addPage([20,20]);
 dictSet(page.pageDict,'Contents',doc.cos.allocateObject(cosStream(new TextEncoder().encode('q 2 2 10 10 re W n 1 0 0 rg 0 0 20 20 re f Q 0 0 1 RG 1 w 1 1 m 18 18 l S'))));
 return doc.save();
}
for(const run of [runPdftocairoCli,runPdftocairoCliSync])for(const format of ['ps','eps'])it(`${run.name} preserves image and clipped vector page pixels in ${format}`,async()=>{
 for(const bytes of [vectorPage(),new Uint8Array(readFileSync(new URL('../../pdf-ast/src/fixtures/pdfjs-cmykjpeg.pdf',import.meta.url)))]){
  const result=await run([`-${format}`,'-r','18','in.pdf','-'],new Map([['in.pdf',bytes]]));
  expect(result.exitCode).toBe(0);
  const output=new TextDecoder().decode(result.stdoutBytes);
  expect(output).toContain('colorimage');
  const data=output.split('colorimage\n')[1]!.split('\ngrestore')[0]!.split('\n').join('');
  expect(data.length).toBeGreaterThan(100);
  expect(new Set(data).size).toBeGreaterThan(1);
  const {renderDisplayListToBitmap}=await import('@poe-code/pdf-ast');
  const bitmap=renderDisplayListToBitmap(PdfDocument.load(bytes).getPage(0).evaluateDisplayList(),{dpi:18});
  const rgb=Buffer.from(data,'hex');
  expect(rgb.length).toBe(bitmap.width*bitmap.height*3);
  for(let pixel=0;pixel<bitmap.width*bitmap.height;pixel++)for(let channel=0;channel<3;channel++){
   if(rgb[pixel*3+channel]!==bitmap.data[pixel*4+channel])throw new Error(`Pixel mismatch at ${pixel}`);
  }
 }
});
