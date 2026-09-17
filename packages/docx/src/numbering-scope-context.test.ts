import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLists, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const future = "urn:original:numbering-context";
const encode = (text: string) => new TextEncoder().encode(text);
type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");
const level = '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>';
const body = ['Selected', 'Retained'].map(text => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');

async function fixture(xml: string, strict: boolean, kind: "docx" | "dotx") {
  const parts = readPackage(await textFixture(body, { numbering: { kind: "numbering", xml } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/archive") as Buffer);
}

async function edit(input: Uint8Array, route: "sdk" | "shell", action: "restart" | "continue", rejection = false) {
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  if (route === "sdk") {
    const result = editDocumentLists(input, action === "restart" ? { operation: "lists.set", options: { paragraph: 1, restart: true, start: 5, output: "-" } } : { operation: "lists.add", options: { paragraph: 1, kind: "decimal", text: "Continued", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
    if (rejection) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" });
    else expect((await result).changes).toHaveLength(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec(`docx lists ${action === "restart" ? 'set /input --paragraph 1 --restart true --start 5' : 'add /input --paragraph 1 --kind decimal --text Continued'} --output - > /out`);
    expect(result.exitCode, result.stderr).toBe(rejection ? 1 : 0);
    if (rejection) expect(result.stderr).toContain("unsupported-edit");
    expect(result.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input);
    memory.writeFileSync("/out", await fs.readFile("/out"));
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer);
  if (rejection) expect(output).toHaveLength(0);
  return output;
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "shell"] as const) for (const carrier of ["local", "instance", "choice", "fallback", "process", "nested", "rebound-prefix", "wildcard"] as const) it(`${route} restart/reopen/continue retains inherited numbering scope in ${carrier}; ${kind} strict=${strict}`, async () => {
  const scope = `mc:Ignorable="f" mc:ProcessContent="f:${carrier === 'wildcard' ? '*' : 'pass'}" mc:PreserveElements="f:opaque" mc:PreserveAttributes="f:stamp"`;
  const override = `<w:lvlOverride w:ilvl="0" f:stamp="original"${carrier === 'local' ? ' ' + scope : ''}><w:startOverride w:val="3"/><f:pass>${level}</f:pass><!--kept--><?audit original?><f:opaque>opaque record</f:opaque></w:lvlOverride>`;
  const inactive = '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="99"/></w:lvlOverride>';
  let content = override, instanceScope = '';
  if (["instance", "wildcard", "rebound-prefix"].includes(carrier)) instanceScope = ' ' + scope;
  if (["choice", "fallback", "nested"].includes(carrier)) content = `<mc:AlternateContent><mc:Choice Requires="${carrier === 'fallback' ? 'f' : 'w'}" ${scope}>${carrier === 'fallback' ? inactive : override}</mc:Choice><mc:Fallback ${scope}>${carrier === 'fallback' ? override : inactive}</mc:Fallback></mc:AlternateContent>`;
  if (carrier === "process" || carrier === "nested") content = `<f:pass ${scope}>${content}</f:pass>`;
  if (carrier === "rebound-prefix") content = content.replace('<w:lvlOverride ', `<w:lvlOverride xmlns:f="urn:original:other" xmlns:g="${future}" `).replace('f:stamp=', 'g:stamp=').split('f:pass').join('g:pass').split('f:opaque').join('g:opaque');
  const xml = `<w:numbering xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="${future}"><w:abstractNum w:abstractNumId="0">${level}</w:abstractNum><w:num w:numId="1"${instanceScope}><w:abstractNumId w:val="0"/>${content}</w:num></w:numbering>`;
  const input = await fixture(xml, strict, kind), before = readPackage(input);
  expect((await Document(input, textContext)).paragraphs.map(p => p.text)).toEqual(['Selected', 'Retained']);
  const restarted = await edit(input, route, "restart"), after = readPackage(restarted);
  assertPackageLinks(after);
  for (const [name, bytes] of before) if (!["word/document.xml", "word/numbering.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const oldRoot = elements(xmlStructure(before.get("word/numbering.xml")!))[0]!, newRoot = elements(xmlStructure(after.get("word/numbering.xml")!))[0]!;
  expect(newRoot.children.slice(0, oldRoot.children.length)).toEqual(oldRoot.children);
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const added = elements(newRoot).at(-1)!; expect(added.attributes[`{${namespace}}numId`]).toBe("2");
  const copied = elements(added).find(n => n.name === `{${namespace}}lvlOverride`)!;
  expect(copied.attributes[`{${future}}stamp`]).toBe("original");
  expect(elements(copied).find(n => n.name === `{${namespace}}startOverride`)!.attributes[`{${namespace}}val`]).toBe("5");
  expect(elements(copied).find(n => n.name === `{${future}}pass`)!.children).toEqual(elements(oldRoot)[0]!.children);
  const continued = await edit(restarted, route, "continue"), final = readPackage(continued);
  expect(final.get("word/numbering.xml")).toEqual(after.get("word/numbering.xml"));
  expect((await Document(continued, textContext)).paragraphs.map(p => p.text)).toEqual(['Selected', 'Continued', 'Retained']);
  const main = elements(xmlStructure(final.get("word/document.xml")!))[0]!, paragraphs = elements(elements(main)[0]!);
  const ids = paragraphs.map(p => elements(elements(elements(p)[0]!)[0]!).find(n => n.name === `{${namespace}}numId`)!.attributes[`{${namespace}}val`]);
  expect(ids).toEqual(['2', '2', '1']);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "shell"] as const) for (const action of ["restart", "continue"] as const) for (const property of ["startOverride", "numFmt", "abstractNumId"] as const) for (const content of ["inert", "active", "text", "trivia"] as const) it(`${route} ${action} respects ${content} scalar descendants of ${property}; ${kind} strict=${strict}`, async () => {
  const child = content === "inert" ? '<f:opaque><w:unverified/></f:opaque>' : content === "active" ? '<w:unverified/>' : content === "text" ? 'unverified scalar text' : ' \n<!--scalar trivia--><?audit retained?>';
  const definition = property === 'numFmt' ? level.replace('<w:numFmt w:val="decimal"/>', `<w:numFmt w:val="decimal">${child}</w:numFmt>`) : level;
  const reference = `<w:abstractNumId w:val="0">${property === 'abstractNumId' ? child : ''}</w:abstractNumId>`;
  const start = `<w:startOverride w:val="3">${property === 'startOverride' ? child : ''}</w:startOverride>`;
  const input = await fixture(`<w:numbering xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f"><w:abstractNum w:abstractNumId="0">${definition}</w:abstractNum><w:num w:numId="1">${reference}<w:lvlOverride w:ilvl="0">${start}</w:lvlOverride></w:num></w:numbering>`, strict, kind);
  const rejected = content === 'active' || content === 'text';
  const output = await edit(input, route, action, rejected);
  if (!rejected) {
    const before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/numbering.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    expect(new TextDecoder().decode(after.get("word/numbering.xml"))).toContain(child);
    if (action === 'restart' && property === 'startOverride') {
      const root = elements(xmlStructure(after.get("word/numbering.xml")!))[0]!, added = elements(root).at(-1)!;
      const override = elements(added).find(n => n.name.endsWith('}lvlOverride'))!, copied = elements(override).find(n => n.name.endsWith('}startOverride'))!;
      const original = elements(elements(elements(xmlStructure(before.get("word/numbering.xml")!))[0]!).at(-1)!).find(n => n.name.endsWith('}lvlOverride'))!;
      expect(copied.children).toEqual(elements(original)[0]!.children);
    }
    expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(action === 'restart' ? ['Selected', 'Retained'] : ['Selected', 'Continued', 'Retained']);
  }
});
