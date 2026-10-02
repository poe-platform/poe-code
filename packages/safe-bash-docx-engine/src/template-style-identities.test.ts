import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocument, createDocumentArchive, createDocxInspectionCommandEngine, readDocumentArchive, writeArchive, writeDocumentArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const escaped of [false, true]) for (const independentSidecar of [false, true]) for (const action of ["copy", "named-style", "heading"] as const) for (const route of ["model", "archive-sdk", "sdk", "shell"] as const) it(`${route} template ${action} escaped=${escaped} independent-sidecar=${independentSidecar}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const styleName = "reports/" + (escaped ? "%E6%B5%B7" : "海") + ".xml", relName = independentSidecar ? "reports/_RELS/BODY.XML.ReLs" : "reports/_rels/body.xml.rels";
  const originalStyle = '<w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coastal Style"/><w:rPr><w:i/></w:rPr></w:style>';
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/body.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/><Override PartName="/${styleName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": `<w:document xmlns:w="${w}"><w:body><!--preserve--><w:p><w:pPr><w:pStyle w:val="Coast"/></w:pPr><w:r><w:t>Original coast</w:t></w:r></w:p></w:body></w:document>`,
    [relName]: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="style" Type="${r}/styles" Target="${styleName.slice(8)}"/></Relationships>`,
    [styleName]: `<w:styles xmlns:w="${w}">${originalStyle}</w:styles>`
  }).map(([name, xml]) => [name, encode(xml)]));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const blocks = action === "copy" ? [] : action === "named-style" ? [{kind: "paragraph" as const, text: "Added coast", style: "Coastal Style"}] : [{kind: "paragraph" as const, text: "Added coast", level: 2}];
  const options = {template: input, content: {version: 1 as const, blocks}};
  if (route === "model") {
    const doc = await Document(undefined, {...textContext, template: input});
    if (action === "named-style") doc.add_paragraph("Added coast", "Coastal Style");
    if (action === "heading") doc.add_heading("Added coast", 2);
    await doc.save(sink);
  } else if (route === "archive-sdk") await writeDocumentArchive(await createDocumentArchive(options, textContext), sink, {order: "input", compression: "store"}, textContext);
  else if (route === "sdk") await createDocument(options, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.bin", input);
    const quote = (word: string) => "'" + word.split("'").join("'\\''") + "'";
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx create --template /input.bin --content-json " + quote(JSON.stringify(options.content)) + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input.bin")).toEqual(original);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (name !== "reports/body.xml" && (action !== "heading" || name !== styleName)) expect(saved.get(name)).toEqual(bytes);
  if (action === "copy") expect(saved).toEqual(parts);
  expect(new TextDecoder().decode(saved.get("reports/body.xml"))).toContain("<!--preserve-->");
  const flatten = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const styles = flatten(xmlStructure(saved.get(styleName)!)).filter(node => node.name === `{${w}}style`);
  expect(styles.find(node => node.attributes[`{${w}}styleId`] === "Coast")).toEqual(flatten(xmlStructure(encode(`<w:styles xmlns:w="${w}">${originalStyle}</w:styles>`))).find(node => node.name === `{${w}}style`));
  const admitted = await readDocumentArchive(output, textContext);
  expect(admitted.kind).toBe(kind); expect(admitted.dialect).toBe(strict ? "strict" : "transitional");
  expect(admitted.package.relationships("/reports/body.xml").filter(edge => edge.reltype === r + "/styles")).toHaveLength(1);
  const doc = await Document(output, textContext);
  expect(doc.paragraphs.map(p => p.text)).toEqual(action === "copy" ? ["Original coast"] : ["Original coast", "Added coast"]);
  if (action === "named-style") expect(doc.paragraphs[1]!.style?.name).toBe("Coastal Style");
  if (action === "heading") {
    expect(styles).toHaveLength(2);
    const heading = styles.find(node => node.attributes[`{${w}}styleId`] !== "Coast")!;
    const outline = flatten(heading).find(node => node.name === `{${w}}outlineLvl`);
    expect(outline?.attributes[`{${w}}val`]).toBe("1");
  }
  expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original));
});
