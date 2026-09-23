import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const samples = [
  { name: "self-closing-empty-text", xml: "<w:r><w:t/></w:r>", text: "", accepted: false },
  { name: "paired-empty-text", xml: "<w:r><w:t></w:t></w:r>", text: "", accepted: false },
  { name: "two-empty-text-runs", xml: "<w:r><w:t/></w:r><w:r><w:t/></w:r>", text: "", accepted: false },
  { name: "properties-only-run", xml: "<w:r><w:rPr><w:i/></w:rPr></w:r>", text: "", accepted: false },
  { name: "preserved-space", xml: '<w:r><w:t xml:space="preserve"> </w:t></w:r>', text: " ", accepted: true },
  { name: "tab", xml: "<w:r><w:tab/></w:r>", text: "\t", accepted: true },
  { name: "positional-tab", xml: '<w:r><w:ptab w:alignment="left" w:relativeTo="indent" w:leader="none"/></w:r>', text: "\t", accepted: true },
  { name: "nonbreaking-hyphen", xml: "<w:r><w:noBreakHyphen/></w:r>", text: "‑", accepted: true },
  { name: "soft-hyphen", xml: "<w:r><w:softHyphen/></w:r>", text: "­", accepted: true },
  { name: "line-break", xml: "<w:r><w:br/></w:r>", text: "\n", accepted: true },
  { name: "carriage-return", xml: "<w:r><w:cr/></w:r>", text: "\n", accepted: true }
] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const) for (const sample of samples)
it(`utility comment logical content preserves model parity; strict=${strict}; kind=${kind}; route=${route}; content=${sample.name}`, async () => {
  const input = await textFixture(`<w:p>${sample.xml}</w:p><!--retained--><?audit exact?>`, {}, strict, { kind });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const locations = await api.openDocumentLocations(input, context), paragraph = locations.at("paragraph", 1);
  expect(locations.text({ select: paragraph.token }).text).toBe(sample.text);
  const select = locations.range(paragraph.token, 0, [...sample.text].length).token;
  const arguments_ = { select, author: "", timestamp: "2026-03-04T05:06:07Z", text: "Added note" };
  const operations = [{ operation: "comments.add", arguments: arguments_ }];
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "sdk" || route === "sdk-batch") {
    const pending = route === "sdk" ? api.editDocumentComments(input, { operation: "comments.add", options: { ...arguments_, output: "-" } }, { ...context, stdout: sink }) : api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    if (sample.accepted) await pending;
    else await expect(pending).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route === "cli" ? `docx comments add /input --select '${select}' --author '' --timestamp 2026-03-04T05:06:07Z --text 'Added note'` : "docx batch /input --ops-file /operations";
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(sample.accepted ? 0 : 2);
      const envelope = JSON.parse(result.stdout);
      expect(envelope).toMatchObject({ affected: sample.accepted ? 1 : 0, ok: sample.accepted });
      if (sample.accepted) memory.writeFileSync("/output", await fs.readFile("/destination"));
      else { expect(envelope.errors[0].code).toBe("usage"); expect(await fs.readFile("/destination")).toEqual(retained); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (sample.accepted) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
    expect((await api.extractDocumentText(output, context)).text).toBe(sample.text);
    expect((await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context)).items[0]).toMatchObject({ comment_id: 0, text: "Added note", issues: [] });
    const editor = new api.DocumentXmlEditor(after.get("word/document.xml")!), paragraph = editor.root.children[0]!.children[0]!;
    expect(paragraph.children.filter(node => node.localName === "r" && !node.children.some(child => child.localName === "commentReference")).map(node => editor.sourceXml(node)).join("")).toBe(sample.xml);
    const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml).toContain("<!--retained-->"); expect(xml).toContain("<?audit exact?>");
    for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
