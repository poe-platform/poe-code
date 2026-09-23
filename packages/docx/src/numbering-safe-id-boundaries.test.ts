import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.flatMap(c => typeof c === "string" ? [] : [c, ...elements(c)]);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const id of [2147483647, 2147483648, 4294967295, Number.MAX_SAFE_INTEGER])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`retains safe numbering ID ${id} when restarting one instance; ${route}; ${kind}; strict=${strict}`, async () => {
  const definition = `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`;
  const p = (text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const parts = readPackage(await textFixture(p('First 日本 עברית é 🌊') + p('Other stays'), { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}">${definition}<!--retain--><?policy keep?></w:numbering>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [{ operation: "lists.set", arguments: { paragraph: 1, restart: true, start: 5 } }];
  const pub = { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } as const };
  if (route === "sdk") await api.editDocumentLists(input, { operation: "lists.set", options: { paragraph: 1, restart: true, start: 5, output: "-" } }, pub);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, pub);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(route === "cli" ? "docx lists set /input --paragraph 1 --restart true --start 5 --output /out --json" : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (name !== "word/document.xml" && name !== "word/numbering.xml") expect(saved.get(name), name).toEqual(bytes);
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, attr = (n: Node, key: string) => n.attributes[`{${ns}}${key}`];
  const nums = elements(xmlStructure(saved.get("word/numbering.xml")!)).filter(n => n.name === `{${ns}}num`); expect(nums.map(n => attr(n, "numId"))).toEqual([String(id), "1"]);
  expect(elements(nums[1]!).find(n => n.name === `{${ns}}abstractNumId`)?.attributes[`{${ns}}val`]).toBe(String(id));
  expect(elements(xmlStructure(saved.get("word/document.xml")!)).filter(n => n.name === `{${ns}}numId`).map(n => attr(n, "val"))).toEqual(["1", String(id)]);
  const before = new TextDecoder().decode(parts.get("word/numbering.xml")), after = new TextDecoder().decode(saved.get("word/numbering.xml")); expect(after).toContain(before!.slice(before!.indexOf('<w:abstractNum '), before!.indexOf('<!--retain-->'))); expect(after).toContain('<!--retain--><?policy keep?>');
});
