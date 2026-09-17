import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, DocumentArchiveEditor, createDocxInspectionCommandEngine, editDocumentLists, editDocumentParagraphs, editDocumentLinks, formatDocumentRuns, replaceDocumentText, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
type Node = ReturnType<typeof xmlStructure>;
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
function assertLinks(parts: Map<string, Uint8Array>): void {
  const names = [...parts.keys()].map(name => decodeURI(name));
  expect(new Set(names).size).toBe(names.length);
  for (const node of nodes(xmlStructure(parts.get("[Content_Types].xml")!)).filter(node => node.name.endsWith("}Override"))) {
    expect(names).toContain(decodeURI(node.attributes["{}PartName"]!.slice(1)));
    expect(node.attributes["{}ContentType"]).toBeTruthy();
  }
  for (const [name, bytes] of parts) if (name.endsWith(".rels")) {
    const owner = name === "_rels/.rels" ? "" : name.replace("/_rels/", "/").slice(0, -5);
    if (owner) expect(parts.has(owner)).toBe(true);
    const edges = nodes(xmlStructure(bytes)).filter(node => node.name === "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship");
    expect(new Set(edges.map(node => node.attributes["{}Id"])).size).toBe(edges.length);
    for (const edge of edges) {
      expect(edge.attributes["{}Type"]).toBeTruthy();
      if (edge.attributes["{}TargetMode"] === "External") continue;
      const target = new URL(edge.attributes["{}Target"]!, "https://assertion.invalid/" + owner);
      expect(target.origin).toBe("https://assertion.invalid");
      expect(names).toContain(decodeURI(target.pathname.slice(1)));
    }
  }
}
async function fixture(strict: boolean, kind: "docx" | "dotx", encoded: boolean, locked = false) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const names = encoded ? { main: "reports/caf%C3%A9.xml", header: "reports/ent%C3%AAte.xml", numbering: "reports/list%C3%A9.xml" }
    : { main: "reports/café.xml", header: "reports/entête.xml", numbering: "reports/listé.xml" };
  const markers = ['<!--retained-->', '<?audit keep?>', '<f:opaque f:value="untouched"/>'];
  const marker = markers.join("");
  const control = '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>Locked</w:t></w:r></w:sdtContent></w:sdt>';
  const paragraph = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Original</w:t></w:r>' + (locked ? control : "") + '</w:p>';
  const declarations = `xmlns:w="${w}" xmlns:r="${r}" xmlns:f="urn:original:opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"`;
  const rels = (content: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
  const edge = (id: string, role: string, target: string) => `<Relationship Id="${id}" Type="${r}/${role}" Target="${target}"/>`;
  const type = (name: string, role: string) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${role}+xml"/>`;
  const members = new Map<string, Uint8Array>(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${type(names.main, kind === "docx" ? "document.main" : "template.main")}${type(names.header, "header")}${type(names.numbering, "numbering")}</Types>`,
    "_rels/.rels": rels(edge("main", "officeDocument", names.main)),
    [names.main]: `<w:document ${declarations}><w:body>${paragraph}${marker}<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:body></w:document>`,
    [names.header]: `<w:hdr ${declarations}>${paragraph}${marker}</w:hdr>`,
    [names.numbering]: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    ["reports/_rels/" + names.main.slice("reports/".length) + ".rels"]: rels(edge("header", "header", names.header.slice("reports/".length)) + edge("numbering", "numbering", names.numbering.slice("reports/".length))),
    "audit/retained.xml": '<records><!--keep--><record>Exact</record></records>'
  }).map(([name, source]) => [name, encode(source)]));
  const memory = Volume.fromJSON({ "/zip": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/zip") as Buffer), members, names, markers, control, w };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const scope of ["body", "headers"] as const) for (const operation of ["replace", "format", "list", "paragraph", "inline", "link"] as const) for (const route of (operation === "replace" || operation === "format" ? ["model", "sdk", "shell"] as const : ["sdk", "shell"] as const)) it(`${route} ${operation} preserves ${scope} part identities; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input, members, names, markers, w } = await fixture(strict, kind, encoded);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const target = scope === "body" ? names.main : names.header;
  if (route === "model") {
    const document = await Document(input, textContext);
    const paragraph = (scope === "body" ? document.paragraphs : document.sections[0]!.header.paragraphs)[0]!;
    if (operation === "replace") paragraph.runs[0]!.text = "Revised";
    else paragraph.runs[0]!.bold = true;
    await document.save(context.stdout);
  } else if (route === "sdk") {
    const options = { scope, paragraph: 1, output: "-" };
    const result = operation === "replace" ? await replaceDocumentText(input, { ...options, find: "Original", with: "Revised", first: true }, context)
      : operation === "format" ? await formatDocumentRuns(input, { ...options, run: 1, bold: true }, context)
      : operation === "list" ? await editDocumentLists(input, { operation: "lists.add", options: { ...options, kind: "decimal", text: "Inserted" } }, context)
      : operation === "link" ? await editDocumentLinks(input, { operation: "links.add", options: { ...options, target: "https://original.invalid/inert", text: "Inserted" } }, context)
      : await editDocumentParagraphs(input, { operation: operation === "inline" ? "runs.add" : "paragraphs.add", options: { ...options, text: "Inserted" } }, context);
    expect(result.changed).toBe(true); expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.before.value.part).toBe("/" + decodeURI(target));
    expect(result.changes[0]!.after.value.part).toBe("/" + decodeURI(target));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const path = operation === "replace" ? "text replace /input --find Original --with Revised --first" : operation === "format" ? "runs set /input --run 1 --bold true" : operation === "list" ? "lists add /input --kind decimal --text Inserted"
      : operation === "link" ? "links add /input --target https://original.invalid/inert --text Inserted" : operation === "inline" ? "runs add /input --text Inserted" : "paragraphs add /input --text Inserted";
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec(`docx ${path} --scope ${scope} --paragraph 1 --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  const saved = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(saved);
  assertLinks(after);
  const relName = target.replace("reports/", "reports/_rels/") + ".rels";
  expect([...after.keys()]).toEqual([...members.keys(), ...(operation === "link" && !members.has(relName) ? [relName] : [])]);
  for (const [name, bytes] of members) if (name !== target && !(operation === "link" && name === relName)) expect(after.get(name), name).toEqual(bytes);
  if (operation === "link") {
    const edges = nodes(xmlStructure(after.get(relName)!)).filter(node => node.name.endsWith("}Relationship"));
    expect(edges.some(node => node.attributes["{}Target"] === "https://original.invalid/inert" && node.attributes["{}TargetMode"] === "External")).toBe(true);
    if (members.has(relName)) for (const edge of nodes(xmlStructure(members.get(relName)!)).filter(node => node.name.endsWith("}Relationship"))) expect(edges).toContainEqual(edge);
  }
  let offset = -1;
  for (const marker of markers) {
    const position = new TextDecoder().decode(after.get(target)).indexOf(marker);
    expect(position).toBeGreaterThan(offset); offset = position;
  }
  const tree = nodes(xmlStructure(after.get(target)!));
  const texts = tree.filter(node => node.name === `{${w}}t`).map(node => node.children.join(""));
  expect(texts).toEqual(operation === "replace" ? ["Revised"] : operation === "format" ? ["Original"] : ["Original", "Inserted"]);
  expect(tree.filter(node => node.name === `{${w}}b`)).toHaveLength(operation === "format" ? 1 : 0);
  if (operation === "list") expect(tree.filter(node => node.name === `{${w}}numId`).map(node => node.attributes[`{${w}}val`])).toEqual(["1", "1"]);
  const reopened = await Document(saved, textContext);
  expect(String(reopened.part.partname)).toBe("/reports/café.xml");
  const paragraphs = operation === "inline" || operation === "link" ? ["OriginalInserted"] : texts;
  expect(reopened.paragraphs.map(node => node.text)).toEqual(scope === "body" ? paragraphs : ["Original"]);
  expect(reopened.sections[0]!.header.paragraphs.map(node => node.text)).toEqual(scope === "headers" ? paragraphs : ["Original"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const name of [null, undefined, 42, {}]) it(`keeps typed XML member lookup errors for ${String(name)}`, async () => {
  const { members } = await fixture(false, "docx", true);
  const editor = new DocumentArchiveEditor({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) });
  expect(() => editor.xml(name as never)).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(editor.dirtyParts).toEqual([]);
  expect(editor.xml("reports/café.xml")).toBe(editor.xml("reports/caf%C3%A9.xml"));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const scope of ["body", "headers"] as const) for (const route of ["sdk", "shell"] as const) it(`${route} retains unrelated locked controls in encoded ${scope}; ${kind} strict=${strict}`, async () => {
  const { input, members, names, control } = await fixture(strict, kind, true, true);
  const memory = Volume.fromJSON({ "/output": "" });
  if (route === "sdk") {
    const result = await replaceDocumentText(input, { scope, paragraph: 1, find: "Original", with: "Revised", first: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    expect(result.changes).toHaveLength(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec(`docx text replace /input --find Original --with Revised --first --scope ${scope} --paragraph 1 --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)), target = scope === "body" ? names.main : names.header;
  assertLinks(after);
  for (const [name, bytes] of members) if (name !== target) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(target));
  expect(xml).toContain(control); expect(xml).toContain("Revised"); expect(xml).not.toContain(">Original<");
});
