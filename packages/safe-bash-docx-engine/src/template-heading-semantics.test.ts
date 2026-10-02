import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocument, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
for (const state of ["missing", "custom-collision", "valid-display", "valid-stored"] as const)
for (const route of ["model", "model-batch", "model-shell", "create-sdk", "create-shell"] as const)
it(`${route} heading ${level} preserves and reuses ${state}; ${kind} strict=${strict}`, async () => {
  const label = level === 0 ? "Title" : `Heading ${level}`, stem = level === 0 ? "Title" : `Heading${level}`;
  const original = state === "missing" ? '<w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coastal Style"/></w:style>'
    : `<w:style w:type="paragraph" w:styleId="${stem}" w:customStyle="${state === "custom-collision" ? "1" : "0"}"><w:name w:val="${state === "valid-stored" && level > 0 ? label.toLowerCase() : label}"/>${level > 0 ? `<w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>` : ""}<w:rPr><w:i/></w:rPr></w:style>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}"><!--styles retained-->${original}</w:styles>`}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: sink};
  const content = {version: 1 as const, blocks: ["First heading", "Second heading"].map(text => ({kind: "paragraph" as const, text, level}))};
  const batch = {version: 1 as const, operations: ["First heading", "Second heading"].map(text => ({operation: "model.document.Document.add_heading.call", receiver: {resultHandle: "document"}, arguments: {text, level}}))};
  if (route === "model") {
    const doc = await Document(undefined, {...textContext, template: input}), retained = doc.styles.at(state === "missing" ? "Coastal Style" : label);
    const first = doc.add_heading("First heading", level), second = doc.add_heading("Second heading", level);
    expect(first.style?.style_id).toBe(second.style?.style_id);
    expect(retained.style_id).toBe(state === "missing" ? "Coast" : stem);
    await doc.save(sink);
  } else if (route === "model-batch") await (await applyStyleModelBatch(input, batch, textContext)).publish({output: "-"}, context);
  else if (route === "create-sdk") await createDocument({template: input, content}, {output: "-"}, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const quote = (word: string) => "'" + word.split("'").join("'\\''") + "'";
    const command = route === "model-shell" ? "docx batch /input --ops-json " + quote(JSON.stringify(batch)) : "docx create --template /input --content-json " + quote(JSON.stringify(content));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(command + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (!["word/document.xml", "word/styles.xml"].includes(name) || name === "word/styles.xml" && state.startsWith("valid")) expect(saved.get(name), name).toEqual(bytes);
  type Node = ReturnType<typeof xmlStructure>;
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const styles = flatten(xmlStructure(saved.get("word/styles.xml")!)).filter(n => n.name === `{${ns}}style`);
  expect(styles).toHaveLength(state.startsWith("valid") ? 1 : 2);
  const originalStyle = flatten(xmlStructure(parts.get("word/styles.xml")!)).find(n => n.name === `{${ns}}style`)!;
  expect(styles).toContainEqual(originalStyle);
  const ids = flatten(xmlStructure(saved.get("word/document.xml")!)).filter(n => n.name === `{${ns}}pStyle`).map(n => n.attributes[`{${ns}}val`]);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const heading = styles.find(n => n.attributes[`{${ns}}styleId`] === ids[0])!;
  expect(heading).toBeDefined(); expect(["0", undefined]).toContain(heading.attributes[`{${ns}}customStyle`]);
  if (state === "custom-collision") expect(ids[0]).not.toBe(stem);
  if (state.startsWith("valid")) expect(ids[0]).toBe(stem);
  if (level > 0) expect(flatten(heading).find(n => n.name === `{${ns}}outlineLvl`)?.attributes[`{${ns}}val`]).toBe(String(level - 1));
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(["Original coast", "First heading", "Second heading"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
