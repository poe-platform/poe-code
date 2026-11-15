import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { encodeJpegImage, type RgbaImage } from '@poe-code/image-ast';
import { createCommandArguments, toByteSource } from 'safe-bash-contracts';
import { PdfDocument, encodePng } from '@poe-code/pdf-ast';
import { createSofficeCommand, createLibreofficeCommand, createStoredZipArchive, runSofficeCliSync, runSofficeCli, runSofficeFileCli } from './index.js';

function deck(problem = '', format = 'png', full = false) {
  const encode = (value: string) => new TextEncoder().encode(value);
  const entries: Record<string, Uint8Array> = {
    'ppt/presentation.xml': encode('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="2" r:id="blue"/><p:sldId id="1" r:id="red"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': encode('<Relationships><Relationship Id="blue" Target="slides/slide2.xml"/><Relationship Id="red" Target="slides/slide1.xml"/></Relationships>')
  };
  for (const [index, color] of [[1, [255, 0, 0, 255]], [2, [0, 0, 255, 255]], [3, [0, 255, 0, 255]]] as const) {
    entries[`ppt/slides/slide${index}.xml`] = encode('<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:pic><a:blip r:embed="image"/><a:xfrm><a:off y="685800" x="914400"/><a:ext cy="1371600" cx="1828800"/></a:xfrm></p:pic></p:sld>');
    entries[`ppt/slides/_rels/slide${index}.xml.rels`] = encode(`<Relationships><Relationship Id="image" Target="../media/${index}.png"/></Relationships>`);
    const image: RgbaImage = {format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, width: 1, height: 1, data: Uint8Array.from(color)};
    entries[`ppt/media/${index}.png`] = format === 'jpeg' ? encodeJpegImage(image) : encodePng(image);
  }
  if (full) {
    entries['ppt/presentation.xml'] = encode(new TextDecoder().decode(entries['ppt/presentation.xml']).replace('</p:sldIdLst>', '<p:sldId id="3" r:id="green"/></p:sldIdLst>'));
    entries['ppt/_rels/presentation.xml.rels'] = encode(new TextDecoder().decode(entries['ppt/_rels/presentation.xml.rels']).replace('</Relationships>', '<Relationship Id="green" Target="slides/slide3.xml"/></Relationships>'));
    for (let index = 1; index <= 3; index++) entries[`ppt/slides/slide${index}.xml`] = encode(new TextDecoder().decode(entries[`ppt/slides/slide${index}.xml`]).replace('y="685800" x="914400"', 'y="0" x="0"').replace('cy="1371600" cx="1828800"', 'cy="6858000" cx="9144000"'));
  }
  if (problem === 'missing image') delete entries['ppt/media/2.png'];
  if (problem === 'missing slide') delete entries['ppt/slides/slide2.xml'];
  if (problem === 'missing relationship') delete entries['ppt/slides/_rels/slide2.xml.rels'];
  if (problem === 'malformed XML') entries['ppt/slides/slide2.xml'] = encode('<p:sld xmlns:p="p"><p:pic></p:sld>');
  if (problem === 'malformed JPEG') entries['ppt/media/2.png'] = Uint8Array.of(255,216,255,217);
  if (problem === 'malformed image') entries['ppt/media/2.png'] = Uint8Array.of(137, 80, 78, 71);
  if (format === 'jpeg') for (const [key, value] of Object.entries(entries)) {
    if (!key.endsWith('.xml') && !key.endsWith('.rels')) continue;
    delete entries[key];
    entries[key.replace('slide2.xml', 'renamed.xml')] = encode(new TextDecoder().decode(value).replaceAll('slide2.xml', 'renamed.xml').replaceAll('"', "'"));
  }
  return createStoredZipArchive(entries);
}
for (const mode of ['sync', 'async', 'retained', 'soffice', 'libreoffice'] as const) {
  for (const format of ['png', 'jpeg']) for (const full of [false, true]) it(`preserves ${format} PPTX ${full ? 'full-page' : 'positioned'} images (${mode})`, async () => {
    const input = deck('', format, full), files = new Map([['/deck.pptx', input]]), args = ['--convert-to', 'pdf', '/deck.pptx'];
    const fs = new MemoryFileSystem(); await fs.writeFile('/deck.pptx', input);
    const result = mode === 'sync' ? runSofficeCliSync(args, files) : mode === 'async' ? await runSofficeCli(args, files) : mode === 'retained' ? await runSofficeFileCli(args, {filesystem: fs, stdout: {async write() {}}, stderr: {async write() {}}}) : await (mode === 'soffice' ? createSofficeCommand() : createLibreofficeCommand()).execute({command: mode, cwd: '/', env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}});
    assert.equal(result.exitCode, 0);
    assert.deepEqual(await fs.readFile('/deck.pptx'), input);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), mode === 'sync' || mode === 'async' ? ['deck.pptx'] : ['deck.pdf', 'deck.pptx']);
    const bytes = mode !== 'sync' && mode !== 'async' ? await fs.readFile('/deck.pdf') : files.get('/deck.pdf')!;
    const pdf = PdfDocument.load(bytes);
    assert.equal(pdf.pageCount, full ? 3 : 2);
    assert.equal(pdf.extractText().trim(), '');
    for (let index = 0; index < pdf.pageCount; index++) {
      const page = pdf.getPage(index);
      assert.equal(page.width, 720); assert.equal(page.height, 540);
      const expected = PdfDocument.create(), reference = expected.addPage([720, 540]);
      const image: RgbaImage = {format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, width: 1, height: 1, data: Uint8Array.from(index === 0 ? [0, 0, 255, 255] : index === 1 ? [255, 0, 0, 255] : [0, 255, 0, 255])};
      reference.drawImage(format === 'jpeg' ? expected.embedJpg(encodeJpegImage(image)) : expected.embedPng(encodePng(image)), full ? {x:0,y:0,width:720,height:540} : {x:72,y:378,width:144,height:108});
      assert.deepEqual(page.renderToPng({scale: 0.5}), reference.renderToPng({scale: 0.5}));
    }
  });
  for (const problem of ['missing image', 'missing slide', 'missing relationship', 'malformed XML', 'malformed image', 'malformed JPEG']) it(`rejects ${problem} without replacing output (${mode})`, async () => {
    const input = deck(problem), previous = Uint8Array.of(1, 2, 3), files = new Map([['/deck.pptx', input], ['/deck.pdf', previous]]), args = ['--convert-to', 'pdf', '/deck.pptx'];
    const fs = new MemoryFileSystem(); await fs.writeFile('/deck.pptx', input); await fs.writeFile('/deck.pdf', previous);
    const result = mode === 'sync' ? runSofficeCliSync(args, files) : mode === 'async' ? await runSofficeCli(args, files) : mode === 'retained' ? await runSofficeFileCli(args, {filesystem: fs, stdout: {async write() {}}, stderr: {async write() {}}}) : await (mode === 'soffice' ? createSofficeCommand() : createLibreofficeCommand()).execute({command: mode, cwd: '/', env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}});
    assert.equal(result.exitCode, 1);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['deck.pdf','deck.pptx']);
    assert.deepEqual(mode !== 'sync' && mode !== 'async' ? await fs.readFile('/deck.pdf') : files.get('/deck.pdf'), previous);
  });
}

for (const mode of ['budget', 'cancel'] as const) it(`preserves output and cleans PPTX backing on ${mode}`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), failure = new Error('cancelled');
  const input = deck(), previous = Uint8Array.of(1, 2, 3);
  await fs.writeFile('/deck.pptx', input); await fs.writeFile('/deck.pdf', previous);
  const filesystem = new Proxy(fs, {get(target, key) {
    if (key === 'createStagedFile' && mode === 'cancel') return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const stage = await fs.createStagedFile(...args);
      controller.abort(failure);
      return stage;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  await assert.rejects(runSofficeFileCli(['--convert-to', 'pdf', '/deck.pptx'], {
    filesystem, signal: controller.signal, limits: mode === 'budget' ? {maxOutputBytes: 10} : {},
    stdout: {async write() {}}, stderr: {async write() {}}
  }), error => mode === 'budget' ? error instanceof RangeError : error === failure);
  assert.deepEqual(await fs.readFile('/deck.pdf'), previous);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['deck.pdf', 'deck.pptx']);
});
