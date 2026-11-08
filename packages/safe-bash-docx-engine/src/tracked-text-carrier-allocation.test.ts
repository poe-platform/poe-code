import { Volume } from "memfs";
import { beforeAll, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true])
  describe(`tracked Choice depth4096 allocation; strict=${strict}`, () => {
    let input: Uint8Array, output: Uint8Array;
    let parts: Map<string, Uint8Array>, memory: Volume;
    const limits = { ...textContext.limits, maxArchiveBytes: 4 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, maxRetainedBytes: 512 * 1024 * 1024 };
    beforeAll(async () => {
      const word = strict ? api.documentDialects.strict.w : api.documentDialects.transitional.w;
      const nested = '<mc:AlternateContent><mc:Choice Requires="w">'.repeat(4096) + '<w:t>A Coast B</w:t>' + '</mc:Choice><mc:Fallback/></mc:AlternateContent>'.repeat(4096);
      parts = readPackage(await textFixture('<w:p/>', {}, strict));
      parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr>${nested}</w:r></w:p></w:body></w:document>`));
      memory = Volume.fromJSON({ "/input": "", "/output": "" });
      await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
      input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    });
    it("edits within the default retained-byte reservation", async () => {
      const budget = new api.DocumentBudget({ xmlDepth: 16384 });
      const result = await api.replaceDocumentText(input, { find: "Coast", with: "Shore", all: true, trackChanges: true, bold: false, italic: true, author: "", timestamp: "2026-03-04T05:06:07Z", output: "-" }, { ...textContext, limits, budget, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
      expect(result.changed).toBe(true);
      expect(budget.usage.retainedBytes).toBeLessThanOrEqual(api.documentLimitDefaults.retainedBytes);
      output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    });
    for (const [view, text] of [["original", "A Coast B"], ["final", "A Shore B"]] as const)
    it(`reads ${view} after bounded editing`, async () => {
      expect(output, "The independent edit must have produced output").toBeInstanceOf(Uint8Array);
      expect((await api.extractDocumentText(output, { ...textContext, limits, budget: new api.DocumentBudget({ xmlDepth: 16384 }) }, { view })).text).toBe(text);
    });
    it("retains all nondirty member bytes and the input", async () => {
      expect(output, "The independent edit must have produced output").toBeInstanceOf(Uint8Array);
      const after = new Map((await api.readArchive(output, { ...textContext, limits })).members.map(member => [member.name, member.bytes]));
      for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  });
  });
