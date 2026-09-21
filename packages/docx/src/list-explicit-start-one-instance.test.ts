import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";
import { textContext } from "../tests/fixtures/text.js";

type Node = ReturnType<typeof xmlStructure>;
function nodes(root: Node): Node[] { const result: Node[] = [], pending = [root]; while (pending.length) { const node = pending.pop()!; result.push(node); for (const child of node.children) if (typeof child !== "string") pending.push(child); } return result; }
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const level of [0, 1, 8]) for (const explicit of [false, true]) for (const route of ["sdk", "ordered-sdk", "cli", "ordered-cli"] as const)
it(`${route} ${explicit ? "restarts with concrete start one" : "continues without new instance"}; level=${level}; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/first": "", "/second": "" });
  const context = (path: string) => ({ ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync(path, bytes); } } });
  await api.editDocumentLists(input, { operation: "lists.add", options: { kind: "decimal", level, start: 1, text: "First explicit one", output: "-" } }, context("/first"));
  const first = new Uint8Array(memory.readFileSync("/first") as Buffer), parts = readPackage(first), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const args = { kind: "decimal" as const, level, ...(explicit ? { start: 1 } : {}), text: "Second explicit one" }, batch = { version: 1 as const, operations: [{ operation: "lists.add", arguments: args }] };
  if (route === "sdk") await api.editDocumentLists(first, { operation: "lists.add", options: { ...args, output: "-" } }, context("/second"));
  else if (route === "ordered-sdk") await api.executeDocumentBatch(first, batch, { output: "-" }, context("/second"));
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", first);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx lists add /input --kind decimal --level ${level}${explicit ? " --start 1" : ""} --text 'Second explicit one'` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
      const result = await shell.exec(command + " --output - > /second"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(first); memory.writeFileSync("/second", await fs.readFile("/second"));
    } finally { await shell.dispose(); }
  }
  const second = new Uint8Array(memory.readFileSync("/second") as Buffer), saved = readPackage(second), story = nodes(xmlStructure(saved.get("word/document.xml")!)), ids = story.filter(node => node.name === `{${w}}numId`).reverse().map(node => node.attributes[`{${w}}val`]);
  expect(ids).toHaveLength(2); expect(ids[1] === ids[0]).toBe(!explicit);
  const numberingName = [...saved.keys()].find(name => name.endsWith("numbering1.xml") || name.endsWith("numbering.xml"))!;
  const graph = nodes(xmlStructure(saved.get(numberingName)!)), old = nodes(xmlStructure(parts.get(numberingName)!));
  expect(graph.filter(node => node.name === `{${w}}abstractNum`)).toEqual(old.filter(node => node.name === `{${w}}abstractNum`));
  if (explicit) {
    const instance = graph.find(node => node.name === `{${w}}num` && node.attributes[`{${w}}numId`] === ids[1])!;
    const override = nodes(instance).find(node => node.name === `{${w}}lvlOverride` && node.attributes[`{${w}}ilvl`] === String(level));
    expect(override, "Explicit start one must override the shared abstract counter in the new concrete instance.").toBeDefined();
    expect(nodes(override!).find(node => node.name === `{${w}}startOverride`)?.attributes[`{${w}}val`]).toBe("1");
  } else expect(saved.get(numberingName)).toEqual(parts.get(numberingName));
  for (const [name, bytes] of parts) if (name !== "word/document.xml" && name !== numberingName) expect(saved.get(name), name).toEqual(bytes);
  const document = await api.Document(second, textContext); expect(document.paragraphs.map(paragraph => paragraph.text)).toEqual(["Retain 日本 עברית é 🌊", "First explicit one", "Second explicit one"]);
});
