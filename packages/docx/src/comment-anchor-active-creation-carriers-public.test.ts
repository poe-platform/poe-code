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
for (const carrier of ["direct", "paragraph-choice", "paragraph-fallback", "paragraph-process", "run-choice", "run-fallback", "run-process"] as const)
for (const remaining of [0, 1, "default"] as const)
for (const route of ["model", "model-sdk-batch", "model-cli-batch", "sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`active comment creation carrier parity; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; carrier=${carrier}; route=${route}${remaining === "default" ? "" : `; remaining=${remaining}`}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const active = '<w:r><w:t>Active海🌊</w:t></w:r>', inactiveRun = '<w:r><w:t>Inactive海🌊</w:t></w:r>';
  const inactive = carrier.startsWith("paragraph-") ? `<w:p>${inactiveRun}</w:p>` : inactiveRun;
  const selected = carrier.startsWith("paragraph-") ? `<w:p>${active}</w:p>` : active;
  const wrapped = carrier.endsWith("process") ? `<o:carrier>${selected}</o:carrier>` : carrier === "direct" ? selected : `<mc:AlternateContent><mc:Choice Requires="${carrier.endsWith("choice") ? "w" : "o"}">${carrier.endsWith("choice") ? selected : inactive}</mc:Choice><mc:Fallback>${carrier.endsWith("fallback") ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
  const declarations = 'xmlns:o="urn:original:comment-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o" mc:ProcessContent="o:carrier"';
  const body = carrier.startsWith("paragraph-") ? `<mc:AlternateContent ${declarations}><mc:Choice Requires="w">${wrapped}</mc:Choice><mc:Fallback><w:p><w:r><w:t>Outer inactive</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>` : `<w:p ${declarations}>${wrapped}</w:p>`;
  const input = await encodeWholeXmlFixture(await textFixture(body, {}, strict, { kind }), codec);
  const original = new Uint8Array(input), originals = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const locations = await api.openDocumentLocations(input, context), paragraph = locations.at("paragraph", 1);
  const select = locations.range(paragraph.token, 0, [...locations.text({ select: paragraph.token }).text].length).token;
  const args = { select, author: "", timestamp: "2026-03-04T05:06:07Z", text: "Coastal observation" };
  const model = route === "model" || route === "model-sdk-batch" || route === "model-cli-batch";
  const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const operations = model ? [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs"), text: args.text, author: "" } }
  ] : [{ operation: "comments.add" as const, arguments: args }];
  const memory = Volume.fromJSON({ "/output": "" }), retained = new TextEncoder().encode("Retained destination");
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const code = remaining === "default" ? null : "limit-exceeded";
  if (route === "model") {
    const budget = new api.DocumentBudget(), document = await api.Document(input, { ...context, budget, timestamp: new Date(args.timestamp) });
    const before = document.part.package.parts.map(part => [String(part.partname), part.blob]);
    if (remaining !== "default") budget.charge("insertedNodes", budget.limits.insertedNodes - budget.usage.insertedNodes - remaining);
    expect(document.paragraphs[0]!.text).toBe("Active海🌊");
    if (code) {
      expect(() => document.add_comment(document.paragraphs[0]!.runs, args.text, "")).toThrowError(expect.objectContaining({ code }));
      expect(document.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
      await document.save(sink); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(original); memory.writeFileSync("/output", "");
    } else { expect(document.add_comment(document.paragraphs[0]!.runs, args.text, "").comment_id).toBe(0); await document.save(sink); }
  } else if (route === "sdk" || route === "sdk-batch" || route === "model-sdk-batch") {
    const publication = { ...context, ...(remaining === "default" ? {} : { budget: new api.DocumentBudget({ insertedNodes: remaining }) }), stdout: sink };
    const pending = route === "sdk" ? api.editDocumentComments(input, { operation: "comments.add", options: { ...args, output: "-" } }, publication) : api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", ...(model ? { timestamp: args.timestamp } : {}) }, publication);
    if (code) { await expect(pending).rejects.toMatchObject({ code, ...(route !== "sdk" ? { operationIndex: model ? 2 : 0 } : {}) }); expect(memory.statSync("/output").size).toBe(0); } else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", retained);
    await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx comments add /input --select '${select}' --author '' --timestamp 2026-03-04T05:06:07Z --text 'Coastal observation'` : "docx batch /input --ops-file /operations" + (model ? " --timestamp 2026-03-04T05:06:07Z" : "");
      const result = await shell.exec(command + " --output /destination --force --json" + (remaining === "default" ? "" : ` --limit insertedNodes=${remaining}`));
      expect(result.exitCode, result.stdout + result.stderr).toBe(code ? 4 : 0);
      if (code) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code, ...(route !== "cli" ? { operationIndex: model ? 2 : 0 } : {}) }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
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
    if (carrier !== "direct" && !carrier.endsWith("process")) expect(decoded).toContain(inactive);
    if (carrier.startsWith("paragraph-")) expect(decoded).toContain('<w:p><w:r><w:t>Outer inactive</w:t></w:r></w:p>');
    expect((await api.extractDocumentText(output, context)).text).toBe("Active海🌊");
    expect(decoded).toContain(active);
    const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
    expect([...saved.get("word/document.xml")!.subarray(0, prefix.length)]).toEqual(prefix);
    for (const [part, bytes] of originals) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  }
  expect(input).toEqual(original);
});
