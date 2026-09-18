import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["paragraphs", "runs"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} reads the explicitly selected ${resource} resource; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>Harbor reading</w:t></w:r></w:p>');
  if (route === "model") {
    const doc = await api.Document(input, textContext), paragraph = doc.paragraphs[0]!;
    expect((resource === "paragraphs" ? paragraph : paragraph.runs[0]!).text).toBe("Harbor reading"); return;
  }
  let item: { text: string; kind: string; location: { token: string }; properties: unknown[]; references: unknown[] };
  if (route === "sdk") {
    const method = (api as unknown as Record<string, (input: Uint8Array, options: object, context: api.ArchiveContext) => Promise<{ item: typeof item }>>)[resource === "paragraphs" ? "inspectDocumentParagraph" : "inspectDocumentRun"]!;
    expect(method).toBeTypeOf("function");
    ({ item } = await method(input, { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) }, textContext));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx ${resource} get /input --paragraph 1${resource === "runs" ? " --run 1" : ""} --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); item = envelope.data.item; expect(envelope.affected).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(item.text).toBe("Harbor reading"); expect(item.location.token).toBeTypeOf("string"); expect(item.properties).toBeInstanceOf(Array); expect(item.references).toEqual([]);
});
