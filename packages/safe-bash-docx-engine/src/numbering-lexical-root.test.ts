import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLists, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { fidelityBytes } from "../tests/fixtures/xml-fidelity.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const)
for (const carrier of ["ordinary", "prolog-comment", "prolog-pi", "epilog-comment", "both-pi"] as const)
for (const route of ["sdk", "shell"] as const) for (const action of ["restart", "new-instance"] as const)
it(`${route} ${action} identifies the real numbering root with ${carrier} ${encoding}; ${kind} strict=${strict}`, async () => {
  const body = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Coastal count</w:t></w:r></w:p>';
  const numbering = `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const parts = readPackage(await textFixture(body, {numbering: {kind: "numbering", xml: numbering}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const realRoot = new TextDecoder().decode(parts.get("word/numbering.xml"));
  const encodingName = encoding === "UTF-8-BOM" ? "UTF-8" : encoding;
  const before = `<?xml version="1.0" encoding="${encodingName}"?>\r\n` + (carrier === "prolog-comment" ? `<!--${realRoot}-->` : ["prolog-pi", "both-pi"].includes(carrier) ? `<?audit ${realRoot}?>` : "<!--before 海-->");
  const after = carrier === "epilog-comment" ? `<!--${realRoot}-->` : carrier === "both-pi" ? `<?audit ${realRoot}?>` : "<?audit after?>";
  parts.set("word/numbering.xml", fidelityBytes(before + realRoot + after, encoding));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await Document(input, textContext)).paragraphs[0]!.text).toBe("Coastal count");
  if (route === "sdk") await editDocumentLists(input, action === "restart" ? {operation: "lists.set", options: {paragraph: 1, restart: true, start: 0, output: "-"}} : {operation: "lists.add", options: {paragraph: 1, kind: "bullet", text: "Added count", start: 0, output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx lists ${action === "restart" ? 'set /input --paragraph 1 --restart true --start 0' : "add /input --paragraph 1 --kind bullet --text 'Added count' --start 0"} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output", await fs.readFile("/output"));
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (!["word/document.xml", "word/numbering.xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const raw = saved.get("word/numbering.xml")!, decoded = new TextDecoder(encodingName, {fatal: true}).decode(raw);
  expect(decoded.startsWith(before)).toBe(true); expect(decoded.endsWith(after)).toBe(true);
  expect(raw).toEqual(fidelityBytes(decoded, encoding));
  type Node = ReturnType<typeof xmlStructure>;
  const children = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");
  const root = children(xmlStructure(encode(decoded))).find(n => n.name.endsWith("}numbering"))!;
  const originalRoot = children(xmlStructure(encode(realRoot)))[0]!;
  for (const node of originalRoot.children) expect(root.children).toContainEqual(node);
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const added = children(root).filter(n => n.name === `{${ns}}num`).at(-1)!;
  expect(added.attributes[`{${ns}}numId`]).toBe("2");
  const override = children(added).find(n => n.name === `{${ns}}lvlOverride`)!;
  expect(children(override)[0]!.attributes[`{${ns}}val`]).toBe("0");
  const decodedParts = new Map(saved); decodedParts.set("word/numbering.xml", encode(decoded)); assertPackageLinks(decodedParts);
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(action === "restart" ? ["Coastal count"] : ["Coastal count", "Added count"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
