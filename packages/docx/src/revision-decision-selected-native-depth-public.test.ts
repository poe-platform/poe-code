import { Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { nativeRepeatTemplate } from "../tests/native-repeat-template.js";
const product = await compiledPublicRuntime;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const execute = await nativeRepeatTemplate(new URL("../tests/fixtures/revision-decision-native.mjs", import.meta.url));

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const depth of [32, 8192]) for (const action of ["accept", "reject"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
describe(`revision decision retains selected admitted native property depth; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; action=${action}; route=${route}`, () => {
  let fixture: Awaited<ReturnType<typeof prepare>> | undefined, completed = false;
  let controller: AbortController;
  async function prepare(controller: AbortController) {
    const limits = { ...textContext.limits, maxArchiveBytes: 2097152, maxEntryBytes: 1048576, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
    const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 };
    const signal = controller.signal;
    const fresh = () => ({ limits, signal, budget: new product.DocumentBudget(documentLimits, signal, async () => {}), encoding: { order: "input", compression: "store" } as const });
    const retained = '<w:rPr>' + '<w:futureProperty>'.repeat(depth) + '<w:leaf/>' + '</w:futureProperty>'.repeat(depth) + '</w:rPr>';
    const body = `<w:p xmlns:f="urn:original:revision-unrelated-property-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:ins w:id="7" w:author="Stored"><w:r>${retained}<w:t>Inserted海🌊</w:t></w:r></w:ins><w:r><w:t>Outside</w:t></w:r></w:p>`;
    const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
    const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`));
    if (codec !== "utf8") for (const [name, bytes] of parts) {
      const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
      if (codec === "utf16be") encoded.swap16();
      parts.set(name, new Uint8Array(encoded));
    }
    const memory = Volume.fromJSON({ "/input": "", "/output": "" });
    await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, fresh().encoding, fresh());
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
    const operation = `revisions.${action}` as const, arguments_ = { revision: 1 }, batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
    return { product, limits, documentLimits, signal, controller, fresh, retained, parts, memory, input, original, operation, arguments_, batch };
  }
  beforeEach(async () => {
    controller = new AbortController();
    const prepared = await prepare(controller);
    controller.signal.throwIfAborted();
    fixture = prepared;
  }, 5000);
  it("executes the public revision decision", async () => {
    const { product, limits, documentLimits, controller, fresh, memory, input, original, operation, arguments_, batch } = fixture!;
    onTestFinished(() => controller.abort());
    if (route === "native-sdk" || route === "native-sdk-batch" || route === "native-cli" || route === "native-cli-batch") {
      const observed = await execute({ input: Buffer.from(input).toString("base64"),
        route, operation, limits, documentLimits, allowed: true });
      expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: true, result: { changed: true, changes: [{ revision: { id: "7", type: "insert" } }] } });
      memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
    } else if (route.includes("sdk")) {
      const io = { ...fresh(), stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
      const result = route.endsWith("batch") ? (await product.executeDocumentBatch(input, batch, { output: "-" }, io)).results[0]!.data : await product.editDocumentRevisionDecisions(input, { operation, options: { ...arguments_, output: "-" } }, io);
      expect(result).toMatchObject({ changed: true, changes: [{ revision: { id: "7", type: "insert" } }] });
    } else {
      const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained forced destination");
      await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
      const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
      try {
        const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops" : `docx revisions ${action} /input --revision 1`) + " --output /output --force --json");
        expect(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(original))).toBe(0);
        if (response.exitCode !== 0) expect(Buffer.compare(Buffer.from(await fs.readFile("/output")), Buffer.from(destination))).toBe(0);
        expect(response.exitCode, response.stdout + response.stderr).toBe(0);
        expect(JSON.parse(response.stdout)).toMatchObject({ ok: true, errors: [] });
        memory.writeFileSync("/output", await fs.readFile("/output"));
      } finally { await shell.dispose(); }
    }
    completed = true;
  });
  afterEach(async () => {
    try {
      if (!completed || !fixture) return;
      const { product, limits, fresh, retained, parts, memory, input, original } = fixture;
      const verification = fresh();
      const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
      expect([...after.keys()]).toEqual([...parts.keys()]);
      for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
      const xml = await product.getDocumentXml(output, verification, { part: "/word/document.xml", raw: true }) as Uint8Array;
      const parsed = await product.parseDocumentXmlAsync(xml, { maxDepth: 16384 }, verification.budget);
      if (action === "accept") expect(parsed.root.children[0]!.children[0]!.children[0]!.children[0]!.localName).toBe("rPr");
      const decoded = codec === "utf8" ? new TextDecoder().decode(xml) : new TextDecoder(codec === "utf16le" ? "utf-16le" : "utf-16be").decode(xml);
      if (action === "accept") expect(decoded).toContain(retained); else expect(decoded).not.toContain(retained);
      expect((await product.extractDocumentText(output, verification)).text).toBe(action === "accept" ? "Inserted海🌊Outside" : "Outside");
      expect((await product.inspectDocumentRevisions(output, {}, verification)).items).toEqual([]);
      expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0); expect(Buffer.compare(Buffer.from(new Uint8Array(memory.readFileSync("/input") as Buffer)), Buffer.from(original))).toBe(0);
    } finally {
      controller?.abort();
      fixture = undefined;
      completed = false;
    }
  }, 5000);
});
