import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeJpegImage, decodePngImage } from "@poe-code/image-ast";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createLibreofficeCommand, createStoredZipArchive, runSofficeCliSync, runSofficeCli, runSofficeFileCli } from "./index.js";

function document(kind: string, problem = "", pageSize = 'w:w="12240" w:h="15840"', extent = 'cx="1828800" cy="914400"') {
  const encode = (text: string) => new TextEncoder().encode(text);
  const drawing = (id: string) => `<w:r><w:drawing><wp:extent ${extent}/><a:blip r:embed="${id}"/></w:drawing></w:r>`;
  const first = '<w:r><w:t>PAGE ONE</w:t></w:r>' + drawing('red');
  const second = '<w:r><w:t>PAGE TWO</w:t></w:r>' + drawing('blue');
  const before = kind === 'before' ? '<w:pageBreakBefore/>' : kind.startsWith('false') ? `<w:pageBreakBefore w:val="${kind.slice(6)}"/>` : '';
  const body = kind === 'inline' ? `<w:p>${first}<w:r><w:br w:type="page"/><w:t>PAGE TWO</w:t></w:r>${drawing('blue')}</w:p>` : `<w:p>${first}${kind === 'break' ? '<w:r><w:br w:type="page"/></w:r>' : ''}</w:p><w:p><w:pPr>${before}</w:pPr>${second}</w:p>`;
  const entries: Record<string, Uint8Array> = {
    'word/document.xml': encode(`<w:document xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r"><w:body>${body}<w:sectPr><w:pgSz ${pageSize}/></w:sectPr></w:body></w:document>`),
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
for (const mode of ['sync','async','retained','command','libreoffice'] as const) {
  for (const [extent, width, height] of [
    ['cx="152400" cy="76200"', 12, 6],
    ['cx="6350" cy="3175"', 0.5, 0.25],
    ['cx="1828800" cy="914400"', 144, 72],
    ['', 432, 226.8],
    ['cx="6350"', 0.5, 226.8],
    ['cy="3175"', 432, 0.25],
    ['cx="12801600" cy="6400800"', 504, 252]
  ] as const) it(`preserves DOCX picture dimensions (${mode}, ${extent})`, async () => {
    const input = document('break', '', undefined, extent), files = new Map([['/doc.docx', input]]), fs = new MemoryFileSystem();
    await fs.writeFile('/doc.docx', input);
    const args = ['--convert-to', 'pdf', '/doc.docx'];
    const result = mode === 'sync' ? runSofficeCliSync(args, files) : mode === 'async' ? await runSofficeCli(args, files) : mode === 'retained' ? await runSofficeFileCli(args, {filesystem: fs, stdout: {async write() {}}, stderr: {async write() {}}}) : await (mode === 'libreoffice' ? createLibreofficeCommand() : createSofficeCommand()).execute({command: mode === 'libreoffice' ? 'libreoffice' : 'soffice', cwd: '/', env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}});
    assert.equal(result.exitCode, 0);
    const pdf = PdfDocument.load(mode === 'sync' || mode === 'async' ? files.get('/doc.pdf')! : await fs.readFile('/doc.pdf'));
    assert.equal(pdf.pageCount, 2);
    for (let index = 0; index < 2; index++) {
      const page = pdf.getPage(index);
      assert.ok(page.extractText().includes(index === 0 ? 'PAGE ONE' : 'PAGE TWO'));
      const images = page.evaluateDisplayList().images;
      assert.equal(images.length, 1);
      assert.ok(Math.abs(images[0]!.matrix[0] - width) < 0.00001);
      assert.ok(Math.abs(Math.abs(images[0]!.matrix[3]) - height) < 0.00001);
    }
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), mode === 'sync' || mode === 'async' ? ['doc.docx'] : ['doc.docx', 'doc.pdf']);
  });
  for (const [pageSize, width, height] of [
    ['w:w="12240" w:h="15840"', 612, 792],
    ['w:w="11906" w:h="16838"', 595.3, 841.9],
    ['w:w="15840" w:h="12240" w:orient="landscape"', 792, 612],
    ['', 612, 792]
  ] as const)
  for (const kind of ['break','before','inline','none','false:0','false:false','false:off']) it(`preserves DOCX ${kind} pages (${mode}, ${width}x${height})`, async () => {
    const input = document(kind, "", pageSize), files = new Map([['/doc.docx',input]]), fs = new MemoryFileSystem();
    await fs.writeFile('/doc.docx',input);
    const args = ['--headless','--convert-to','pdf','/doc.docx'];
    const result = mode === 'sync' ? runSofficeCliSync(args,files) : mode === 'async' ? await runSofficeCli(args,files) : mode === 'retained' ? await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(){}},stderr:{async write(){}}}) : await (mode === 'libreoffice' ? createLibreofficeCommand() : createSofficeCommand()).execute({command:mode === 'libreoffice' ? 'libreoffice' : 'soffice',cwd:'/',env:{},fs,...createCommandArguments(args),signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
    assert.equal(result.exitCode,0);
    const pdf = PdfDocument.load(mode === 'sync' || mode === 'async' ? files.get('/doc.pdf')! : await fs.readFile('/doc.pdf'));
    const split = ['break','before','inline'].includes(kind);
    assert.equal(pdf.pageCount,split ? 2 : 1);
    for(let index=0;index<pdf.pageCount;index++) {
      const page = pdf.getPage(index);
      assert.ok(Math.abs(page.width - width) < 0.001); assert.ok(Math.abs(page.height - height) < 0.001);
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
  for (const [twips, expectedHeight, heightPages, widthPages] of [[15840, 792, 1, 2], [12240, 612, 2, 1]] as const)
  for (const layout of ['height', 'width'] as const) it(`uses DOCX ${layout} for automatic layout (${mode}, ${expectedHeight})`, async () => {
    const body = Array.from({length: layout === 'height' ? 30 : 20}, (_, index) => `<w:p><w:r><w:t>${layout === 'height' ? 'ROW ' + index : Array(20).fill('word').join(' ')}</w:t></w:r></w:p>`).join('');
    const input = createStoredZipArchive({'word/document.xml': new TextEncoder().encode(`<w:document xmlns:w="w"><w:body>${body}<w:sectPr><w:pgSz w:w="${twips === 15840 ? 12240 : 15840}" w:h="${twips}"/></w:sectPr></w:body></w:document>`)});
    const files = new Map([['/doc.docx', input]]), fs = new MemoryFileSystem();
    await fs.writeFile('/doc.docx', input);
    const args = ['--convert-to', 'pdf', '/doc.docx'];
    const result = mode === 'sync' ? runSofficeCliSync(args, files) : mode === 'async' ? await runSofficeCli(args, files) : mode === 'retained' ? await runSofficeFileCli(args, {filesystem: fs, stdout: {async write() {}}, stderr: {async write() {}}}) : await (mode === 'libreoffice' ? createLibreofficeCommand() : createSofficeCommand()).execute({command: mode === 'libreoffice' ? 'libreoffice' : 'soffice', cwd: '/', env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}});
    assert.equal(result.exitCode, 0);
    const pdf = PdfDocument.load(mode === 'sync' || mode === 'async' ? files.get('/doc.pdf')! : await fs.readFile('/doc.pdf'));
    assert.equal(pdf.pageCount, layout === 'height' ? heightPages : widthPages);
    for (let index = 0; index < pdf.pageCount; index++) assert.equal(pdf.getPage(index).height, expectedHeight);
  });
  for (const dimension of ['w', 'h'])
  for (const problem of ['missing','invalid','jpeg','jpeg-tables','size:0','size:-1','size:NaN','size:Infinity','size:288001','size:bad','size:','size:0x100','size:1.5', ...['0', '-1', 'NaN', 'Infinity', 'bad', '', '0x100', '1.5', '1e309'].map(value => 'extent:' + value)]) it(`rejects DOCX ${problem} image and preserves output (${mode}, ${dimension})`,async()=>{
    const input=document('break',problem, problem.startsWith('size:') ? `w:${dimension}="${problem.slice(5)}"` : 'w:w="12240" w:h="15840"', problem.startsWith('extent:') ? `${dimension === 'w' ? 'cx' : 'cy'}="${problem.slice(7)}"` : undefined), previous=Uint8Array.of(1,2,3), files=new Map([['/doc.docx',input],['/doc.pdf',previous]]),fs=new MemoryFileSystem();
    await fs.writeFile('/doc.docx',input);await fs.writeFile('/doc.pdf',previous);
    const args=['--convert-to','pdf','/doc.docx'];
    const result=mode==='sync'?runSofficeCliSync(args,files):mode==='async'?await runSofficeCli(args,files):mode==='retained'?await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(){}},stderr:{async write(){}}}):await (mode === 'libreoffice' ? createLibreofficeCommand() : createSofficeCommand()).execute({command:mode === 'libreoffice' ? 'libreoffice' : 'soffice',cwd:'/',env:{},fs,...createCommandArguments(args),signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
    assert.equal(result.exitCode,1);
    assert.deepEqual(mode==='sync'||mode==='async'?files.get('/doc.pdf'):await fs.readFile('/doc.pdf'),previous);
    assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name).sort(),['doc.docx','doc.pdf']);
  });
}

for (const mode of ['write', 'finish', 'publish', 'cancel', 'budget'] as const) it(`preserves DOCX output and cleans staging on ${mode}`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), failure = new Error(mode);
  const input = document('break', '', 'w:w="15840" w:h="12240"'), previous = Uint8Array.of(1, 2, 3);
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
