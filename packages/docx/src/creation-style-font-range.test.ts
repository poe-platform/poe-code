import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage, xmlStructure } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const type of ["paragraph", "character", "table"] as const)
 for (const route of ["model", "archive", "sdk", "cli"] as const)
 it(`admits the maximum font size independently of page extent; ${route}; ${type}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Original template</w:t></w:r></w:p>');
  const content: api.DocxContent = { version: 1, blocks: [], styles: [{ name: "Atlas é 日本", type, size: { value: 1638, unit: "pt" }, bold: false, italic: true }] };
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "model") {
   const doc = await api.Document(input, textContext);
   const style = doc.styles.add_style("Atlas é 日本", api.WD_STYLE_TYPE[type === "paragraph" ? "PARAGRAPH" : type === "character" ? "CHARACTER" : "TABLE"]);
   expect(style).toBeInstanceOf(api.CharacterStyle);
   if (!(style instanceof api.CharacterStyle)) throw new Error("Expected a formatting style.");
   style.font.size = api.Pt(1638); style.font.bold = false; style.font.italic = true;
   expect(style.font.size?.pt).toBe(1638); await doc.save(sink);
  } else if (route === "archive") {
   const archive = await api.createDocumentArchive({ kind, dialect: strict ? "strict" : "transitional", template: input, content }, textContext);
   await api.writeDocumentArchive(archive, sink, { order: "input", compression: "store" }, textContext);
  } else if (route === "sdk") {
   await api.createDocument({ kind, dialect: strict ? "strict" : "transitional", template: input, content }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
   const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try {
    const result = await shell.exec(`docx create --kind ${kind} --dialect ${strict ? "strict" : "transitional"} --template /input --content-json '${JSON.stringify(content)}' --output /out --json`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).ok).toBe(true);
    memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
   } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), parts = readPackage(output); assertPackageLinks(parts);
  const doc = await api.Document(output, textContext), style = doc.styles.at("Atlas é 日本");
  expect(style).toBeInstanceOf(api.CharacterStyle);
  if (!(style instanceof api.CharacterStyle)) throw new Error("Expected a formatting style.");
  expect(style.type.name).toBe(type.toUpperCase()); expect(style.font.size?.pt).toBe(1638);
  expect(style.font.bold).toBe(false); expect(style.font.italic).toBe(true);
  const styleXml = xmlStructure(parts.get(doc.styles.part.partname.toString().slice(1))!);
  const flatten = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  expect(flatten(styleXml).filter(node => node.name === `{${w}}sz`).map(node => node.attributes[`{${w}}val`])).toEqual(["3276"]);
  expect(parts.get("_rels/.rels")).toEqual(readPackage(input).get("_rels/.rels"));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
 });

const fontBoundaries = [
 { emu: 3174, halfPoints: null }, { emu: 3175, halfPoints: 1 },
 { emu: 20116800, halfPoints: 3168 }, { emu: 20119975, halfPoints: 3169 },
 { emu: 20802600, halfPoints: 3276 }, { emu: 20805774, halfPoints: 3276 },
 { emu: 20805775, halfPoints: null }, { emu: 0, halfPoints: null },
 { emu: -0.001, halfPoints: null }
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const type of ["paragraph", "character", "table"] as const)
 for (const { emu, halfPoints } of fontBoundaries)
 it(`keeps font conversion boundaries distinct from page limits; ${emu} EMUs; ${type}; ${kind}; strict=${strict}`, async () => {
  const options: api.DocumentCreateOptions = { kind, dialect: strict ? "strict" : "transitional", content: { version: 1, blocks: [], styles: [{ name: "Boundary", type, size: { value: emu, unit: "emu" } }] } };
  if (halfPoints === null) {
   await expect(api.createDocumentArchive(options, textContext)).rejects.toMatchObject({ code: "usage" });
   return;
  }
  const archive = await api.createDocumentArchive(options, textContext), memory = Volume.fromJSON({ "/out": "" });
  await api.writeDocumentArchive(archive, { async write(bytes) { memory.appendFileSync("/out", bytes); } }, { order: "input", compression: "store" }, textContext);
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer); assertPackageLinks(readPackage(output));
  const style = (await api.Document(output, textContext)).styles.at("Boundary");
  expect(style).toBeInstanceOf(api.CharacterStyle);
  if (!(style instanceof api.CharacterStyle)) throw new Error("Expected a formatting style.");
  expect(style.font.size?.pt).toBe(halfPoints / 2);
 });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 it(`retains the page extent ceiling after separating font conversion; ${kind}; strict=${strict}`, async () => {
  const options: api.DocumentCreateOptions = { kind, dialect: strict ? "strict" : "transitional", content: { version: 1, blocks: [], page: { width: { value: 22, unit: "in" } } } };
  await expect(api.createDocumentArchive(options, textContext)).resolves.toMatchObject({ kind });
  await expect(api.createDocumentArchive({ ...options, content: { ...options.content!, page: { width: { value: 22.001, unit: "in" } } } }, textContext)).rejects.toMatchObject({ code: "usage" });
 });
