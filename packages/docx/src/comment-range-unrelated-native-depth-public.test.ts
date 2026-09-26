import { Volume } from "memfs";
import { fileURLToPath } from "node:url";
import { useNativeProcess } from "../tests/native-process.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const execute = useNativeProcess([fileURLToPath(new URL("../tests/fixtures/comment-range-native.mjs", import.meta.url))]);

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const placement of ["unrelated-native", "selected-inert-properties"] as const)
for (const depth of [32, 4096, 8192]) for (const route of ["model", "sdk", "cli", "native-model", "native-sdk", "native-cli"] as const)
describe(`comment range creation retains unrelated admitted native depth; strict=${strict}; kind=${kind}; depth=${depth}; route=${route}${placement === "unrelated-native" ? "" : "; placement=selected-inert-properties"}`, () => {
  let fixture: Awaited<ReturnType<typeof prepare>>, completed = false;
  async function prepare() {
    const limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288, maxRetainedBytes: 1073741824 };
    const xmlDepth = depth === 8192 ? 16384 : 8192;
    const budget = new api.DocumentBudget({ xmlDepth, retainedBytes: 1073741824, work: 1073741824 }, textContext.signal, async () => {});
    const context = { ...textContext, limits, budget, timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
    const parts = readPackage(await textFixture('<w:p><w:r><w:t>Anchor海🌊</w:t></w:r></w:p>', {}, strict, { kind }));
    const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const unrelated = '<w:customXml>'.repeat(depth) + '<w:p><w:r><w:t>Unselected日本🌊</w:t></w:r></w:p>' + '</w:customXml>'.repeat(depth);
    const inert = '<o:future>'.repeat(depth) + '<o:leaf o:stored="Retained日本🌊"/>' + '</o:future>'.repeat(depth);
    const properties = placement === "selected-inert-properties" ? `<w:rPr xmlns:o="urn:original:inert-properties" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o"><w:i/>${inert}</w:rPr>` : "";
    const retainedSubtree = placement === "unrelated-native" ? unrelated : properties;
    parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}"><w:body><w:p><w:r>${properties}<w:t>Anchor海🌊</w:t></w:r></w:p><!--outside-->${placement === "unrelated-native" ? unrelated : ""}<?audit exact?></w:body></w:document>`));
    const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [
      { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
      { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "Added note", author: "" }, resultHandle: "comment" },
      { operation: "model.comments.Comment.comment_id.get", receiver: ref("comment"), arguments: {} }
    ];
    return { context, limits, xmlDepth, parts, memory, sink, input, operations, retainedSubtree };
  }
  beforeEach(async () => { fixture = await prepare(); }, 5000);
  it("executes the public comment operation", async () => {
    const { context, limits, xmlDepth, memory, sink, input, operations } = fixture;
    if (route.startsWith("native-")) {
      const observed = await execute({ input: Buffer.from(input).toString("base64"), limits, xmlDepth, operations, route }) as {
        ok: boolean; output?: string; error?: string; stack?: string; code?: string; outputBytes?: number; sourceRetained?: boolean
      };
      if (placement === "selected-inert-properties") {
        expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: false, code: "unsupported-edit", outputBytes: 0, sourceRetained: true });
        memory.writeFileSync("/output", input);
      } else {
        expect(observed.ok, observed.stack ?? observed.error).toBe(true);
        memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
      }
    } else if (route === "model") {
      const doc = await api.Document(input, context);
      if (placement === "selected-inert-properties") {
        const before = doc.part.package.parts.map(part => [String(part.partname), part.blob]);
        try { doc.add_comment(doc.paragraphs[0]!.runs[0]!, "Added note", ""); throw new Error("Expected refusal"); }
        catch (error) { expect(error).toMatchObject({ code: "unsupported-edit" }); }
        expect(doc.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
        expect(memory.statSync("/output").size).toBe(0); await doc.save(sink);
      } else {
        const comment = doc.add_comment(doc.paragraphs[0]!.runs[0]!, "Added note", "");
        expect(comment.comment_id).toBe(0); await doc.save(sink);
      }
    } else if (route === "sdk") {
      const pending = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: "2026-03-04T05:06:07Z" }, { ...context, stdout: sink });
      if (placement === "selected-inert-properties") {
        await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0);
        memory.writeFileSync("/output", input);
      } else expect((await pending).results.at(-1)!.data).toBe(0);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits: { xmlDepth, retainedBytes: 1073741824, work: 1073741824 } }) }));
      try {
        const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2026-03-04T05:06:07Z --output /destination --force --json`);
        if (placement === "selected-inert-properties") {
          expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 2 }] });
          expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained destination"); memory.writeFileSync("/output", input);
        } else {
          expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(0);
          memory.writeFileSync("/output", await fs.readFile("/destination"));
        }
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    completed = true;
  });
  afterEach(async () => {
    if (!completed) return;
    const { context, xmlDepth, parts, memory, input, retainedSubtree } = fixture;
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), xml = new TextDecoder().decode(after.get("word/document.xml"));
    if (placement === "selected-inert-properties") {
      expect(output).toEqual(input); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); return;
    }
    expect(xml).toContain(retainedSubtree); expect(xml).toContain("<!--outside-->"); expect(xml).toContain("<?audit exact?>");
    for (const [name, bytes] of parts) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    const reopened = await api.Document(output, { ...context, budget: new api.DocumentBudget({ xmlDepth, retainedBytes: 1073741824, work: 1073741824 }, context.signal, async () => {}) });
    expect(reopened.comments.get(0)!.text).toBe("Added note"); expect(reopened.comments.get(0)!.author).toBe("");
    expect(reopened.comments.get(0)!.timestamp?.toISOString()).toBe("2026-03-04T05:06:07.000Z");
    expect(reopened.paragraphs[0]!.text).toBe("Anchor海🌊"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  }, 5000);
});
