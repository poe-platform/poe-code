import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeJpegImage, decodePngImage } from "@poe-code/image-ast";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCliSync, runSofficeCli, runSofficeFileCli } from "./index.js";

function document(kind: string, problem = "") {
  const encode = (text: string) => new TextEncoder().encode(text);
  const drawing = (id: string) => `<w:r><w:drawing><wp:extent cx="1828800" cy="914400"/><a:blip r:embed="${id}"/></w:drawing></w:r>`;
  const first = '<w:r><w:t>PAGE ONE</w:t></w:r>' + drawing('red');
  const second = '<w:r><w:t>PAGE TWO</w:t></w:r>' + drawing('blue');
  const before = kind === 'before' ? '<w:pageBreakBefore/>' : kind.startsWith('false') ? `<w:pageBreakBefore w:val="${kind.slice(6)}"/>` : '';
  const body = kind === 'inline' ? `<w:p>${first}<w:r><w:br w:type="page"/><w:t>PAGE TWO</w:t></w:r>${drawing('blue')}</w:p>` : `<w:p>${first}${kind === 'break' ? '<w:r><w:br w:type="page"/></w:r>' : ''}</w:p><w:p><w:pPr>${before}</w:pPr>${second}</w:p>`;
  const entries: Record<string, Uint8Array> = {
    'word/document.xml': encode(`<w:document xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
    'word/_rels/document.xml.rels': encode('<Relationships><Relationship Id="red" Target="media/red.png"/><Relationship Id="blue" Target="media/blue.png"/></Relationships>'),
    'word/media/red.png': encodePng({width:1,height:1,data:Uint8Array.of(255,0,0,255)}),
    'word/media/blue.png': encodePng({width:1,height:1,data:Uint8Array.of(0,0,255,255)})
  };
  if (problem === 'missing') delete entries['word/media/blue.png'];
  if (problem === 'invalid') entries['word/media/blue.png'] = Uint8Array.of(1,2,3);
  if (problem === 'jpeg') entries['word/media/blue.png'] = Uint8Array.of(255,216,255,217);
  if (problem === 'jpeg-tables') {
    const bytes = encodeJpegImage({format: "jpeg", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false, width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255)});
    const parts = [bytes.subarray(0, 2)];
    let offset = 2;
    while (bytes[offset + 1] !== 0xda) {
      const end = offset + 2 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
      if (bytes[offset + 1] !== 0xdb) parts.push(bytes.subarray(offset, end));
      offset = end;
    }
    parts.push(bytes.subarray(offset));
    entries['word/media/blue.png'] = Uint8Array.from(parts.flatMap(part => [...part]));
  }
  return createStoredZipArchive(entries);
}
for (const mode of ['sync','async','retained','command'] as const) {
  for (const kind of ['break','before','inline','none','false:0','false:false','false:off']) it(`preserves DOCX ${kind} pages (${mode})`, async () => {
    const input = document(kind), files = new Map([['/doc.docx',input]]), fs = new MemoryFileSystem();
    await fs.writeFile('/doc.docx',input);
    const args = ['--headless','--convert-to','pdf','/doc.docx'];
    const result = mode === 'sync' ? runSofficeCliSync(args,files) : mode === 'async' ? await runSofficeCli(args,files) : mode === 'retained' ? await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(){}},stderr:{async write(){}}}) : await createSofficeCommand().execute({command:'soffice',cwd:'/',env:{},fs,...createCommandArguments(args),signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
    assert.equal(result.exitCode,0);
    const pdf = PdfDocument.load(mode === 'sync' || mode === 'async' ? files.get('/doc.pdf')! : await fs.readFile('/doc.pdf'));
    const split = ['break','before','inline'].includes(kind);
    assert.equal(pdf.pageCount,split ? 2 : 1);
    for(let index=0;index<pdf.pageCount;index++) {
      const page = pdf.getPage(index);
      assert.equal(page.width,612); assert.equal(page.height,792);
      const text = page.extractText();
      assert.equal(text.includes('PAGE ONE'),!split || index === 0);
      assert.equal(text.includes('PAGE TWO'),!split || index === 1);
      const images = page.evaluateDisplayList().images;
      assert.equal(images.length,split ? 1 : 2);
      const raster = decodePngImage(page.renderToPng({scale: 1}));
      let red = 0, blue = 0;
      for (let offset = 0; offset < raster.data.length; offset += 4) {
        if (raster.data[offset] === 255 && raster.data[offset + 1] === 0 && raster.data[offset + 2] === 0) red++;
        if (raster.data[offset] === 0 && raster.data[offset + 1] === 0 && raster.data[offset + 2] === 255) blue++;
      }
      assert.ok(!split || index === 0 ? red >= 144 * 72 && red <= 145 * 73 : red === 0);
      assert.ok(!split || index === 1 ? blue >= 144 * 72 && blue <= 145 * 73 : blue === 0);
    }
    assert.deepEqual(await fs.readFile('/doc.docx'), input);
    assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name).sort(),mode === 'sync' || mode === 'async' ? ['doc.docx'] : ['doc.docx','doc.pdf']);
  });
  for (const problem of ['missing','invalid','jpeg','jpeg-tables']) it(`rejects DOCX ${problem} image and preserves output (${mode})`,async()=>{
    const input=document('break',problem), previous=Uint8Array.of(1,2,3), files=new Map([['/doc.docx',input],['/doc.pdf',previous]]),fs=new MemoryFileSystem();
    await fs.writeFile('/doc.docx',input);await fs.writeFile('/doc.pdf',previous);
    const args=['--convert-to','pdf','/doc.docx'];
    const result=mode==='sync'?runSofficeCliSync(args,files):mode==='async'?await runSofficeCli(args,files):mode==='retained'?await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(){}},stderr:{async write(){}}}):await createSofficeCommand().execute({command:'soffice',cwd:'/',env:{},fs,...createCommandArguments(args),signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
    assert.equal(result.exitCode,1);
    assert.deepEqual(mode==='sync'||mode==='async'?files.get('/doc.pdf'):await fs.readFile('/doc.pdf'),previous);
    assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name).sort(),['doc.docx','doc.pdf']);
  });
}

for (const mode of ['write', 'finish', 'publish', 'cancel', 'budget'] as const) it(`preserves DOCX output and cleans staging on ${mode}`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), failure = new Error(mode);
  const input = document('break'), previous = Uint8Array.of(1, 2, 3);
  await fs.writeFile('/doc.docx', input); await fs.writeFile('/doc.pdf', previous);
  const filesystem = new Proxy(fs, {get(target, key) {
    if (key === 'publishStagedFile' && mode === 'publish') return async () => { throw failure; };
    if (key === 'createStagedFile') return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const stage = await fs.createStagedFile(...args);
      return {...stage, writer: {
        async write(bytes: Uint8Array, options?: {signal?: AbortSignal}) {
          if (mode === 'write') throw failure;
          await stage.writer!.write(bytes, options);
          if (mode === 'cancel') controller.abort(failure);
        },
        async finish(options?: {signal?: AbortSignal}) {
          if (mode === 'finish') throw failure;
          return stage.writer!.finish(options);
        }
      }};
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  await assert.rejects(runSofficeFileCli(['--convert-to', 'pdf', '/doc.docx'], {
    filesystem, signal: controller.signal, limits: mode === 'budget' ? {maxOutputBytes: 10} : {},
    stdout: {async write() {}}, stderr: {async write() {}}
  }), error => mode === 'budget' ? error instanceof RangeError : error === failure);
  assert.deepEqual(await fs.readFile('/doc.pdf'), previous);
  assert.deepEqual(await fs.readFile('/doc.docx'), input);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['doc.docx', 'doc.pdf']);
});
