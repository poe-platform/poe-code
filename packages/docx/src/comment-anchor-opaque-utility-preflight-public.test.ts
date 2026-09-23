import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const shape of ["ignored-property", "processed-property", "fallback-property", "run-attribute", "unrelated-opaque"] as const)
for (const remaining of [0, 1, "default"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`utility comment anchor ownership preflight; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; shape=${shape}; remaining=${remaining}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const properties = shape === "ignored-property" ? '<w:rPr><w:i/><o:leaf/></w:rPr>'
    : shape === "processed-property" ? '<w:rPr><o:carrier><w:i/></o:carrier></w:rPr>'
    : shape === "fallback-property" ? '<w:rPr><mc:AlternateContent><mc:Choice Requires="o"><o:leaf/></mc:Choice><mc:Fallback><w:i/></mc:Fallback></mc:AlternateContent></w:rPr>' : "";
  const unrelated = shape === "unrelated-opaque" ? '<w:p xmlns:o="urn:original:utility-preflight" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o"><w:r><w:rPr><o:leaf o:stored="Retained海🌊"/></w:rPr><w:t>Unselected</w:t></w:r></w:p>' : "";
  const input = await encodeWholeXmlFixture(await textFixture(`<w:p xmlns:o="urn:original:utility-preflight" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o" mc:ProcessContent="o:carrier"><w:r${shape === "run-attribute" ? ' o:stored="Retained海🌊"' : ""}>${properties}<w:t>Coastal anchor</w:t></w:r></w:p>` + unrelated, {}, strict, { kind }), codec);
  const original = new Uint8Array(input), originals = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const locations = await api.openDocumentLocations(input, context), paragraph = locations.at("paragraph", 1);
  const select = locations.range(paragraph.token, 0, [...locations.text({ select: paragraph.token }).text].length).token;
  const args = { select, author: "", timestamp: "2026-03-04T05:06:07Z", text: "Coastal observation" };
  const operations = [{ operation: "comments.add" as const, arguments: args }];
  const memory = Volume.fromJSON({ "/output": "" }), retained = new TextEncoder().encode("Retained destination");
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const code = shape !== "unrelated-opaque" ? "unsupported-edit" : remaining === "default" ? null : "limit-exceeded";
  if (route === "sdk" || route === "sdk-batch") {
    const publication = { ...context, ...(remaining === "default" ? {} : { budget: new api.DocumentBudget({ insertedNodes: remaining }) }), stdout: sink };
    const pending = route === "sdk" ? api.editDocumentComments(input, { operation: "comments.add", options: { ...args, output: "-" } }, publication) : api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, publication);
    if (code) { await expect(pending).rejects.toMatchObject({ code, ...(route === "sdk-batch" ? { operationIndex: 0 } : {}) }); expect(memory.statSync("/output").size).toBe(0); }
    else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", retained);
    await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx comments add /input --select '${select}' --author '' --timestamp 2026-03-04T05:06:07Z --text 'Coastal observation'` : "docx batch /input --ops-file /operations";
      const result = await shell.exec(command + " --output /destination --force --json" + (remaining === "default" ? "" : ` --limit insertedNodes=${remaining}`));
      expect(result.exitCode, result.stdout + result.stderr).toBe(code === "limit-exceeded" ? 4 : code ? 1 : 0);
      if (code) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code, ...(route === "cli-batch" ? { operationIndex: 0 } : {}) }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1 }); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  if (code) expect(memory.statSync("/output").size).toBe(0);
  else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    const comments = await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context);
    expect(comments.items[0]).toMatchObject({ comment_id: 0, author: "", text: "Coastal observation", issues: [] });
    const decoded = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(saved.get("word/document.xml")!);
    expect(decoded).toContain(unrelated);
    for (const [part, bytes] of originals) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  }
  expect(input).toEqual(original);
});
