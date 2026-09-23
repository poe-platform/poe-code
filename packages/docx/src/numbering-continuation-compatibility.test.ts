import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLists, writeArchive } from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const alternate = (selected: string, inactive: string, fallback = false) => `<mc:AlternateContent><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : selected}</mc:Choice><mc:Fallback>${fallback ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
const level = '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>';
const abstract = (id: number, content = level) => `<w:abstractNum w:abstractNumId="${id}">${content}</w:abstractNum>`;
const num = (id: number, definition = 0) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${definition}"/></w:num>`;
type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");
const cases = ["direct", "choice", "fallback", "process", "equal-inactive", "conflicting-inactive", "abstract", "level", "level-properties", "instance-reference", "override", "override-properties", "ignorable-attributes", "paragraph-properties", "paragraph-numbering", "style", "style-properties", "ignored-invalid-reference", "custom-xml", "custom-xml-ignored"] as const;

async function withKind(input: Uint8Array<ArrayBuffer>, kind: "docx" | "dotx"): Promise<Uint8Array<ArrayBuffer>> {
  if (kind === "docx") return input;
  const parts = readPackage(input), memory = Volume.fromJSON({ "/zip": "" });
  parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2025-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/zip") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "cli", "shell"] as const) for (const action of ["continue", "restart"] as const) for (const carrier of cases) it(`${route} ${action} uses active numbering in ${carrier}; strict=${strict}${kind === "dotx" ? '; kind=dotx' : ''}`, async () => {
  let definitions = abstract(0), instance = num(1);
  if (carrier === "choice" || carrier === "fallback" || carrier === "equal-inactive") instance = alternate(instance, num(carrier === "equal-inactive" ? 1 : 9), carrier === "fallback");
  if (carrier === "process") instance = `<f:pass>${instance}</f:pass>`;
  if (carrier === "conflicting-inactive") { instance = alternate(instance, num(1, 7)); definitions += abstract(7); }
  if (carrier === "abstract") definitions = alternate(definitions, abstract(7));
  if (carrier === "level") definitions = abstract(0, alternate(level, level));
  if (carrier === "level-properties") definitions = abstract(0, `<w:lvl w:ilvl="0">${alternate('<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>', '<w:start w:val="7"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>')}</w:lvl>`);
  if (carrier === "instance-reference") instance = `<w:num w:numId="1">${alternate('<w:abstractNumId w:val="0"/>', '<w:abstractNumId w:val="7"/>')}</w:num>`;
  if (carrier === "override" || carrier === "override-properties") {
    const properties = '<w:startOverride w:val="3"/>' + level;
    const override = `<w:lvlOverride w:ilvl="0">${carrier === "override-properties" ? alternate(properties, '<w:startOverride w:val="9"/>' + level) : properties}</w:lvlOverride>`;
    instance = `<w:num w:numId="1"><w:abstractNumId w:val="0"/>${carrier === "override" ? alternate(override, override) : override}</w:num>`;
  }
  if (carrier === "ignorable-attributes") instance = '<w:num w:numId="1" mc:Ignorable="f" f:hint="retain"><w:abstractNumId w:val="0"/></w:num>';
  if (carrier === "ignored-invalid-reference") instance += '<f:opaque><w:numId w:val="not-a-number"/></f:opaque>';
  const props = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
  const selectedProps = carrier === "paragraph-properties" ? `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="w">${props}</mc:Choice><mc:Fallback>${props}</mc:Fallback></mc:AlternateContent>`
    : carrier === "paragraph-numbering" ? `<w:pPr xmlns:mc="${mc}">${alternate('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')}</w:pPr>`
    : carrier === "style" || carrier === "style-properties" ? '<w:pPr><w:pStyle w:val="Listing"/></w:pPr>' : props;
  const paragraph = (text: string, properties: string) => `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const style = `<w:style w:styleId="Listing" w:type="paragraph"><w:name w:val="Listing"/>${carrier === "style-properties" ? alternate(props, props) : props}</w:style>`;
  const stories = { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass">${definitions}${instance}</w:numbering>` },
    ...(carrier === "style" || carrier === "style-properties" ? { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${carrier === "style" ? alternate(style, style) : style}</w:styles>` } } : {}) };
  let input = await textFixture(paragraph("Selected", selectedProps) + paragraph("Retained", props), stories, strict);
  if (carrier === "custom-xml" || carrier === "custom-xml-ignored") {
    const members = readPackage(input);
    const types = new TextDecoder().decode(members.get("[Content_Types].xml"));
    members.set("[Content_Types].xml", new TextEncoder().encode(types!.replace("</Types>", '<Override PartName="/custom/item.xml" ContentType="application/xml"/></Types>')));
    // A malformed reserved MCE element rejects unless its containing namespace
    // is explicitly ignorable. The ignored variant must remain byte-exact.
    const content = '<mc:MustUnderstand>stored vocabulary</mc:MustUnderstand>';
    members.set("custom/item.xml", new TextEncoder().encode(`<data xmlns="urn:original:records" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f">${carrier === "custom-xml-ignored" ? `<f:opaque>${content}</f:opaque>` : content}</data>`));
    const memory = Volume.fromJSON({ "/zip": "" });
    await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2025-01-02T03:04:06Z") })) },
      { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
    input = new Uint8Array(memory.readFileSync("/zip") as Buffer);
  }
  input = await withKind(input, kind);
  const before = readPackage(input), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  // Malformed reserved control markup rejects; understood selected list
  // references retain their inactive carriers while accepting scoped edits.
  const expectedRejection = carrier === "custom-xml" ? "invalid-xml" : undefined;
  if (route === "sdk") {
    const request = action === "continue" ? { operation: "lists.add" as const, options: { paragraph: 1, kind: "decimal" as const, text: "Continued", output: "-" } } : { operation: "lists.set" as const, options: { paragraph: 1, restart: true, start: 5, output: "-" } };
    const pending = editDocumentLists(input, request, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    if (expectedRejection) await expect(pending).rejects.toMatchObject({ code: expectedRejection });
    else expect((await pending).changes).toHaveLength(1);
  } else {
    const args = action === "continue" ? ["lists", "add", "/input", "--paragraph", "1", "--kind", "decimal", "--text", "Continued", "--output", "-"] : ["lists", "set", "/input", "--paragraph", "1", "--restart", "true", "--start", "5", "--output", "-"];
    const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
    let result: { exitCode: number };
    if (route === "cli") result = await engine.execute({ args: args.map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine }));
      const execution = await shell.exec("docx " + args.map(arg => "'" + arg.split("'").join("'\\''") + "'").join(" ") + " > /saved");
      result = execution; volume.writeFileSync("/err", execution.stderr); volume.writeFileSync("/out", await fs.readFile("/saved"));
      expect(execution.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input);
    }
    expect(result.exitCode, String(volume.readFileSync("/err"))).toBe(expectedRejection ? 1 : 0);
    if (expectedRejection) expect(String(volume.readFileSync("/err"))).toContain(expectedRejection);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  if (expectedRejection) { expect(volume.statSync("/out").size).toBe(0); return; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), after = readPackage(output);
  assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml" && (action === "continue" || name !== "word/numbering.xml")) expect(after.get(name), name).toEqual(bytes);
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const active = (node: Node): Node[] => elements(node).flatMap(child => child.name === `{${mc}}AlternateContent`
    ? active(elements(child).find(branch => branch.name === `{${mc}}Choice` && branch.attributes["{}Requires"] === "w") ?? elements(child).find(branch => branch.name === `{${mc}}Fallback`)!)
    : child.name === "{urn:original:future}pass" ? active(child) : [child]);
  if (action === "restart") {
    const oldRoot = elements(xmlStructure(before.get("word/numbering.xml")!)).find(node => node.name === `{${namespace}}numbering`)!;
    const newRoot = elements(xmlStructure(after.get("word/numbering.xml")!)).find(node => node.name === `{${namespace}}numbering`)!;
    expect(newRoot.children.slice(0, oldRoot.children.length)).toEqual(oldRoot.children);
    expect(elements(newRoot).at(-1)!.attributes[`{${namespace}}numId`]).toBe("2");
    const override = active(elements(newRoot).at(-1)!).find(child => child.name === `{${namespace}}lvlOverride`)!;
    expect(active(override).find(child => child.name === `{${namespace}}startOverride`)!.attributes[`{${namespace}}val`]).toBe("5");
  }
  const root = elements(xmlStructure(after.get("word/document.xml")!)).find(node => node.name === `{${namespace}}document`)!;
  const body = elements(root).find(node => node.name === `{${namespace}}body`)!;
  const paragraphs = elements(body).filter(node => node.name === `{${namespace}}p`);
  const directId = (node: Node) => {
    const props = active(node).find(child => child.name === `{${namespace}}pPr`)!;
    const numbering = active(props).find(child => child.name === `{${namespace}}numPr`)!;
    return active(numbering).find(child => child.name === `{${namespace}}numId`)!.attributes[`{${namespace}}val`];
  };
  expect(directId(paragraphs[action === "continue" ? 1 : 0]!)).toBe(action === "continue" ? "1" : "2");
  expect(directId(paragraphs.at(-1)!)).toBe("1");
  expect((await Document(output, textContext)).paragraphs.map(paragraph => paragraph.text)).toEqual(action === "continue" ? ["Selected", "Continued", "Retained"] : ["Selected", "Retained"]);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "shell"] as const) for (const inert of ["invalid", "inactive-level"] as const) it(`${route} mixes an unused level around ${inert} references; strict=${strict}${kind === "dotx" ? '; kind=dotx' : ''}`, async () => {
  const levels = Array.from({ length: 9 }, (_, index) => `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${index + 1}."/></w:lvl>`).join("");
  const opaque = `<f:opaque>${inert === "invalid" ? '<w:numId w:val="invalid"/>' : '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>'}</f:opaque>`;
  const source = `<w:numbering xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f">${abstract(0, '<w:multiLevelType w:val="multilevel"/>' + levels)}${num(1)}${opaque}</w:numbering>`;
  const input = await withKind(await textFixture('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Selected</w:t></w:r></w:p>', { numbering: { kind: "numbering", xml: source } }, strict), kind);
  const memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await editDocumentLists(input, { operation: "lists.add", options: { paragraph: 1, kind: "bullet", level: 1, text: "Nested", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx lists add /input --paragraph 1 --kind bullet --level 1 --text Nested --output - > /out");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/out", await fs.readFile("/out"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  assertPackageLinks(after);
  for (const [name, bytes] of before) if (!["word/document.xml", "word/numbering.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  expect(new TextDecoder().decode(after.get("word/numbering.xml"))).toContain(opaque);
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const root = elements(xmlStructure(after.get("word/numbering.xml")!)).find(node => node.name === `{${namespace}}numbering`)!;
  const instance = elements(root).filter(node => node.name === `{${namespace}}num`).at(-1)!;
  expect(instance.attributes[`{${namespace}}numId`]).toBe(inert === "invalid" ? "1" : "2");
  const id = elements(instance)[0]!.attributes[`{${namespace}}val`];
  const definition = elements(root).find(node => node.name === `{${namespace}}abstractNum` && node.attributes[`{${namespace}}abstractNumId`] === id)!;
  const formats = elements(definition).filter(node => node.name === `{${namespace}}lvl`).map(node => elements(node).find(child => child.name === `{${namespace}}numFmt`)!.attributes[`{${namespace}}val`]);
  expect(formats).toEqual(inert === "invalid" ? ["decimal", "bullet", ...Array.from({ length: 7 }, () => "decimal")] : Array.from({ length: 9 }, () => "bullet"));
  if (inert === "inactive-level") expect(new TextDecoder().decode(after.get("word/numbering.xml"))).toContain(num(1));
  expect((await Document(output, textContext)).paragraphs.map(node => node.text)).toEqual(["Selected", "Nested"]);
});
