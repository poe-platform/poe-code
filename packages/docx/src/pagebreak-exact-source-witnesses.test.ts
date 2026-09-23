import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";
const props = '<w:pPr><w:ind/></w:pPr>', r = (s: string) => `<w:r>${s}</w:r>`, t = (s: string) => `<w:t>${s}</w:t>`, br = '<w:lastRenderedPageBreak/>', p = (s: string) => `<w:p>${s}</w:p>`;
const cases = [
  // Format contract 9.1 exposes ordered cached fragments; original first-only refusals are retained in the receipt.
  { row: 1301, body: p(r(t('abc') + br + br)), index: 1, member: 'preceding_paragraph_fragment', sourceFirstBreakRefusal: true, expected: p(r(t('abc') + br)) },
  { row: 1302, body: p(props + r(br + t('foo') + t('bar'))), index: 0, member: 'preceding_paragraph_fragment', expected: null },
  { row: 1303, body: p(props + r(t('foo') + br + t('bar')) + r(t('barfoo'))), index: 0, member: 'preceding_paragraph_fragment', expected: p(props + r(t('foo'))) },
  { row: 1304, body: p(props + '<w:hyperlink>' + r(t('foo') + br + t('bar')) + '</w:hyperlink>' + r(t('barfoo'))), index: 0, member: 'preceding_paragraph_fragment', expected: p(props + '<w:hyperlink>' + r(t('foo') + t('bar')) + '</w:hyperlink>') },
  { row: 1305, body: p(r(br + br + t('abc'))), index: 1, member: 'following_paragraph_fragment', sourceFirstBreakRefusal: true, expected: p(r(t('abc'))) },
  { row: 1306, body: p(props + r(t('foo') + t('bar') + br)), index: 0, member: 'following_paragraph_fragment', expected: null },
  { row: 1307, body: p(props + r(t('foo') + br + t('bar')) + r(t('foo'))), index: 0, member: 'following_paragraph_fragment', expected: p(props + r(t('bar')) + r(t('foo'))) },
  { row: 1308, body: p(props + '<w:hyperlink>' + r(t('foo') + br + t('bar')) + '</w:hyperlink>' + r(t('baz')) + r(t('qux'))), index: 0, member: 'following_paragraph_fragment', expected: p(props + r(t('baz')) + r(t('qux'))) }
];
expect(cases.map(c => c.row)).toEqual(Array.from({ length: 8 }, (_, i) => 1301 + i));
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ['docx', 'dotx'] as const) for (const c of cases) for (const route of ['model', 'sdk', 'shell'])
it(`${route} independently executes exact cached-break witness R${c.row}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture(c.body, {}, strict));
  if (kind === 'dotx') parts.set('[Content_Types].xml', new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('wordprocessingml.document.main+xml', 'wordprocessingml.template.main+xml')));
  const volume = Volume.fromJSON({ '/input': '', '/out': '' });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date('2026-01-02T03:04:06Z') })) }, { async write(bytes) { volume.appendFileSync('/input', bytes); } }, { order: 'input', compression: 'store' }, textContext);
  const input = new Uint8Array(volume.readFileSync('/input') as Buffer), ns = strict ? 'http://purl.oclc.org/ooxml/wordprocessingml/main' : w, expected = c.expected ? xmlStructure(new TextEncoder().encode(c.expected.replace('<w:p>', `<w:p xmlns:w="${ns}">`))) : null;
  const operations = [
    { operation: 'model.document.Document.paragraphs.get', receiver: ref('document'), arguments: {}, resultHandle: 'paragraphs' },
    { operation: 'model.text.paragraph.Paragraph.rendered_page_breaks.get', receiver: ref('paragraphs', 0), arguments: {}, resultHandle: 'breaks' },
    { operation: `model.text.pagebreak.RenderedPageBreak.${c.member}.get`, receiver: ref('breaks', c.index), arguments: {}, resultHandle: 'fragment' },
    ...(c.expected ? [{ operation: 'model.text.paragraph.Paragraph.element.get', receiver: ref('fragment'), arguments: {}, resultHandle: 'element' }, { operation: 'model.XmlElementView.serialize.call', receiver: ref('element'), arguments: {} }] : [])
  ];
  if (route === 'model') {
    const doc = await api.Document(input, textContext), before = doc.element.serialize(), marker = doc.paragraphs[0]!.rendered_page_breaks[c.index]!;
    { const fragment = Reflect.get(marker, c.member) as api.Paragraph | null; if (expected) { expect(fragment).toBeInstanceOf(api.Paragraph); expect(xmlStructure(fragment!.element.serialize())).toEqual(expected); } else expect(fragment).toBeNull(); }
    expect(doc.element.serialize()).toEqual(before); await doc.save({ async write(bytes) { volume.appendFileSync('/out', bytes); } });
  } else if (route === 'sdk') {
    { const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext), value = batch.results.at(-1)!.value; if (expected) expect(xmlStructure(new Uint8Array(Buffer.from((value as { base64: string }).base64, 'base64')))).toEqual(expected); else expect(value).toBeNull(); expect(batch.affected).toBe(0); await batch.save({ async write(bytes) { volume.appendFileSync('/out', bytes); } }); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile('/input', input); await fs.writeFile('/out', new TextEncoder().encode('Original destination'));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); { const value = envelope.data.results.at(-1).data; if (expected) expect(xmlStructure(new Uint8Array(Buffer.from(value.base64, 'base64')))).toEqual(expected); else expect(value).toBeNull(); await (await api.Document(input, textContext)).save({ async write(bytes) { volume.appendFileSync('/out', bytes); } }); } expect(await fs.readFile('/input')).toEqual(input); expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination'); } finally { await shell.dispose(); }
  }
  { const after = readPackage(new Uint8Array(volume.readFileSync('/out') as Buffer)); assertPackageLinks(after); expect(after.size).toBe(parts.size); for (const [name, bytes] of parts) expect(after.get(name), name).toEqual(bytes); }
  expect(volume.readFileSync('/input')).toEqual(Buffer.from(input));
});
