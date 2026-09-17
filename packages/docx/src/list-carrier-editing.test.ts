import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLists, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006", future = "urn:original:list-carrier";
const encode = (text: string) => new TextEncoder().encode(text);
type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");
const active = (node: Node): Node[] => elements(node).flatMap(child => child.name === `{${mc}}AlternateContent` ? active(elements(child).find(n => n.name === `{${mc}}Choice` && n.attributes['{}Requires'] === 'w') ?? elements(child).find(n => n.name === `{${mc}}Fallback`)!) : child.name === `{${future}}pass` ? active(child) : child.name.startsWith(`{${future}}`) ? [] : [child]);
function inactive(node: Node): Node[] {
  const result: Node[] = [];
  for (const child of elements(node)) {
    if (child.name === `{${mc}}AlternateContent`) {
      const selected = elements(child).find(n => n.name === `{${mc}}Choice` && n.attributes['{}Requires'] === 'w') ?? elements(child).find(n => n.name === `{${mc}}Fallback`)!;
      result.push(...elements(child).filter(n => n !== selected));
    }
    result.push(...inactive(child));
  }
  return result;
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "shell"] as const) for (const action of ["restart", "level"] as const) for (const carrier of ["choice", "fallback", "process"] as const) for (const binding of ["properties", "numbering", "id", "level", "style", "id-active", "level-active", "numbering-active", "numbering-ignored", "id-ignored", "property-change", "property-inert"] as const) it(`${route} ${action} on ${binding} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const wrap = (selected: string, other: string) => carrier === 'process' ? `<f:pass mc:ProcessContent="f:pass">${selected}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === 'choice' ? 'w' : 'f'}">${carrier === 'choice' ? selected : other}</mc:Choice><mc:Fallback>${carrier === 'fallback' ? selected : other}</mc:Fallback></mc:AlternateContent>`;
  const rejected = binding.endsWith('-active') || binding === 'property-change';
  const extra = rejected ? '<w:unverified/>' : '<f:opaque f:stamp="keep">inert record</f:opaque>';
  const id = `<w:numId w:val="1">${binding.startsWith('id-') ? extra : ''}</w:numId>`, level = `<w:ilvl w:val="0">${binding === 'level-active' ? extra : ''}</w:ilvl>`;
  const numbering = `<w:numPr f:stamp="retained">${binding === 'level' || binding.startsWith('level-') ? wrap(level, '<w:ilvl w:val="8"/>') : level}${binding === 'id' || binding.startsWith('id-') ? wrap(id, '<w:numId w:val="7"/>') : id}${binding.startsWith('numbering-') ? extra : ''}</w:numPr>`;
  const style = '<w:pStyle w:val="Listed"/>';
  const other = '<w:numPr><w:numId w:val="7"/></w:numPr>';
  const change = '<w:pPrChange w:id="8" w:author="Reviewer" w:date="2026-01-02T03:04:06Z"><w:pPr/></w:pPrChange>';
  const props = `<w:pPr>${binding === 'style' ? wrap(style, '<w:pStyle w:val="Other"/>') : ''}<w:keepNext/>${binding === 'style' ? '' : binding === 'numbering' || binding.startsWith('numbering-') ? wrap(numbering, other) : numbering}<!--property trivia--><f:opaque>Keep property data</f:opaque>${binding === 'property-change' ? wrap(change, '<f:opaque>inactive</f:opaque>') : binding === 'property-inert' ? wrap('<f:opaque>' + change + '</f:opaque>', '<f:opaque>inactive</f:opaque>') : ''}</w:pPr>`;
  const selected = `<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f">${binding === 'properties' ? wrap(props, '<w:pPr>' + other + '</w:pPr>') : props}<w:r><w:t>Selected</w:t></w:r></w:p>`;
  const untouched = '<w:p><w:r><w:t>Untouched</w:t></w:r></w:p>';
  const levels = [0, 1].map(i => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${i + 1}."/></w:lvl>`).join('');
  const parts = readPackage(await textFixture(selected + untouched, {
    numbering: { kind: 'numbering', xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0">${levels}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>` },
    styles: { kind: 'styles', xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Listed"><w:name w:val="Listed"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>` }
  }, strict));
  if (kind === 'dotx') parts.set('[Content_Types].xml', encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('wordprocessingml.document.main+xml', 'wordprocessingml.template.main+xml')));
  const memory = Volume.fromJSON({ '/input': '', '/out': '' });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date('2026-01-02T03:04:06Z') })) }, { async write(bytes) { memory.appendFileSync('/input', bytes); } }, { order: 'input', compression: 'store' }, textContext);
  const input = new Uint8Array(memory.readFileSync('/input') as Buffer);
  expect((await Document(input, textContext)).paragraphs.map(p => p.text)).toEqual(['Selected', 'Untouched']);
  if (route === 'sdk') {
    const result = editDocumentLists(input, { operation: 'lists.set', options: { paragraph: 1, ...(action === 'restart' ? { restart: true, start: 5 } : { level: 1 }), output: '-' } }, { ...textContext, encoding: { order: 'input', compression: 'store' }, stdout: { async write(bytes) { memory.appendFileSync('/out', bytes); } } });
    if (rejected) await expect(result).rejects.toMatchObject({ code: 'unsupported-edit' }); else expect((await result).changes).toHaveLength(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile('/input', input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec(`docx lists set /input --paragraph 1 ${action === 'restart' ? '--restart true --start 5' : '--level 1'} --output - > /out`);
    expect(result.exitCode, result.stderr).toBe(rejected ? 1 : 0); if (rejected) expect(result.stderr).toContain('unsupported-edit'); expect(result.stdout).toBe(''); expect(await fs.readFile('/input')).toEqual(input); memory.writeFileSync('/out', await fs.readFile('/out'));
  }
  expect(memory.readFileSync('/input')).toEqual(Buffer.from(input));
  const output = new Uint8Array(memory.readFileSync('/out') as Buffer);
  if (rejected) { expect(output).toHaveLength(0); return; }
  const saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (name !== 'word/document.xml' && (action === 'level' || name !== 'word/numbering.xml')) expect(saved.get(name), name).toEqual(bytes);
  const before = xmlStructure(parts.get('word/document.xml')!), after = xmlStructure(saved.get('word/document.xml')!); expect(inactive(after)).toEqual(inactive(before));
  const ns = strict ? 'http://purl.oclc.org/ooxml/wordprocessingml/main' : w;
  const paragraphs = active(active(elements(after)[0]!)[0]!);
  const properties = active(paragraphs[0]!).filter(n => n.name === `{${ns}}pPr`); expect(properties).toHaveLength(1);
  const numberingProperties = active(properties[0]!).filter(n => n.name === `{${ns}}numPr`); expect(numberingProperties).toHaveLength(1);
  const values = active(numberingProperties[0]!);
  expect(values.filter(n => n.name === `{${ns}}numId`)).toHaveLength(1); expect(values.find(n => n.name === `{${ns}}numId`)!.attributes[`{${ns}}val`]).toBe(action === 'restart' ? '2' : '1');
  expect(values.filter(n => n.name === `{${ns}}ilvl`)).toHaveLength(1); expect(values.find(n => n.name === `{${ns}}ilvl`)!.attributes[`{${ns}}val`]).toBe(action === 'restart' ? '0' : '1');
  const source = new TextDecoder().decode(saved.get('word/document.xml')); expect(source).toContain(untouched); expect(source).toContain('<!--property trivia--><f:opaque>Keep property data</f:opaque>');
  if (binding.endsWith('-ignored')) expect(source).toContain(extra);
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(['Selected', 'Untouched']);
});
