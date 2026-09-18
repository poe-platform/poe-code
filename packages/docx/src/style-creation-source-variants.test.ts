import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const builtin of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} creates ${builtin ? "builtin paragraph" : "custom numbering"} style in ${carrier}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const retained = '<w:style w:type="paragraph" w:styleId="Style1"><w:name w:val="Retained Ledger"/></w:style>', inactive = '<w:style w:type="paragraph" w:styleId="Old"><w:name w:val="Inactive Ledger"/></w:style>', process = (body: string) => `<f:carrier>${body}</f:carrier>`, choice = (body: string, fallback = false) => `<mc:AlternateContent><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : body}</mc:Choice><mc:Fallback>${fallback ? body : inactive}</mc:Fallback></mc:AlternateContent>`;
  const wrapped = carrier === "direct" ? retained : carrier === "choice" ? choice(retained) : carrier === "fallback" ? choice(retained, true) : carrier === "process" ? process(retained) : choice(process(retained));
  const styles = `<?xml version="1.0"?><!--retained prolog--><w:styles xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:ledger:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">${wrapped}<?audit keep?></w:styles>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Style factory ledger</w:t></w:r></w:p>', { styles: { kind: "styles", xml: styles } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), type = builtin ? api.WD_STYLE_TYPE.PARAGRAPH : api.WD_STYLE_TYPE.LIST, name = builtin ? "Heading 1" : "Ledger Sequence";
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: { name, styleType: type, builtin }, resultHandle: "created" },
    ...["name", "type", "builtin", "style_id"].map(member => ({ operation: `model.styles.style.BaseStyle.${member}.get`, receiver: ref("created"), arguments: {} })),
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: name }, resultHandle: "looked" },
    { operation: "model.styles.style.BaseStyle.style_id.get", receiver: ref("looked"), arguments: {} }
  ];
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  let id: string | null;
  if (route === "model") {
    const doc = await api.Document(input, context), created = doc.styles.add_style(name, type, builtin); id = created.style_id;
    expect(created.name).toBe(name); expect(created.type).toEqual(type); expect(created.builtin).toBe(builtin); expect([...doc.styles].at(-1)!.equals(created)).toBe(true); expect(doc.styles.at(name).equals(created)).toBe(true); expect(created.part).toBe(doc.styles.part); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    expect(result.results.slice(2, 5).map(r => r.data)).toEqual([name, type, builtin]); id = result.results[5]!.data as string; expect(result.results[7]!.data).toBe(id);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"), envelope = JSON.parse(response.stdout); expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(envelope.data.results.slice(2, 5).map((r: { data: unknown }) => r.data)).toEqual([name, type, builtin]); id = envelope.data.results[5].data; expect(envelope.data.results[7].data).toBe(id); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  expect(id).toBe("Style2");
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)), xml = new TextDecoder().decode(saved.get("word/styles.xml")!);
  for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  for (const token of [retained, "<!--retained prolog-->", "<?audit keep?>"]) expect(xml).toContain(token); if (["choice", "fallback", "nested"].includes(carrier)) expect(xml).toContain(inactive);
  const tree = xmlStructure(saved.get("word/styles.xml")!), walk = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : walk(child))], created = walk(tree).find(node => node.attributes[`{${w}}styleId`] === id)!;
  expect(created.attributes[`{${w}}type`]).toBe(builtin ? "paragraph" : "numbering"); expect(created.attributes[`{${w}}customStyle`]).toBe(builtin ? undefined : "1");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
