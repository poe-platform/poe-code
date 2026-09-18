import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const) for (const scenario of ["self", "part-view", "plain", "null"] as const)
it(`${route} compares ${scenario} document ownership without writes; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p><w:r><w:t>Shared inlet</w:t></w:r></w:p>"), memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const same = scenario === "self" || scenario === "part-view";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("part"), arguments: {}, resultHandle: "view" },
    ...["__eq__", "__ne__"].map(method => ({ operation: `model.document.Document.${method}.call`, receiver: ref("document"), arguments: { other: scenario === "self" ? ref("document") : scenario === "part-view" ? ref("view") : scenario === "plain" ? {} : null } }))
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext), before = document.element.serialize();
    const equality = (document as unknown as { equals(other: unknown): boolean }).equals;
    expect(equality).toBeTypeOf("function");
    const other = scenario === "self" ? document : scenario === "part-view" ? document.part.document : scenario === "plain" ? {} : null;
    expect(equality.call(document, other)).toBe(same); expect(!equality.call(document, other)).toBe(!same); expect(document.element.serialize()).toEqual(before);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, {}, { ...textContext, encoding: { order: "input", compression: "store" } });
    expect(result.results.slice(-2).map(item => item.data)).toEqual([same, !same]); expect(result.publication).toBeNull(); expect(result.results.every(item => item.affected === 0)).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope.data.results.slice(-2).map((item: { data: unknown }) => item.data)).toEqual([same, !same]); expect(envelope.affected).toBe(0); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`distinguishes independently admitted document owners; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const document = await api.Document(input, textContext), other = await api.Document(input, textContext);
  const equality = (document as unknown as { equals(other: unknown): boolean }).equals; expect(equality).toBeTypeOf("function"); expect(equality.call(document, other)).toBe(false);
});
