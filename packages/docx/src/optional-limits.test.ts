import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { modelContext } from "./model-context.js";
import { parseDocumentXml } from "./package-xml.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { readArchive } from "./archive.js";
import { validateDocxValue } from "./operation-schema.js";
import { insertDocumentImage } from "./image-insertion.js";
import { paragraph, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("uses a finite conservative byte estimate before unlimited publication", async () => {
  const input = await textFixture(paragraph("Image"));
  let admitted = false;
  await insertDocumentImage(input, { operation: "images.add", options: {
    file: { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") }, paragraph: 1, output: "-"
  } }, { ...modelContext(), encoding: { order: "input", compression: "store" },
    admitPublication(planned) { expect(Number.isSafeInteger(planned.output!.bytes)).toBe(true); admitted = true; return undefined; },
    stdout: { async write() { expect(admitted).toBe(true); } }
  });
  expect(admitted).toBe(true);
});

it("validates argument graphs without a hidden depth ceiling", () => {
  let value: unknown = "text";
  for (let i = 0; i < 300; i++) value = { value };
  expect(validateDocxValue("unknown", value)).toBe(true);
});

it("leaves omitted document resources unlimited, including with one limit", () => {
  for (const budget of [new DocumentBudget(), new DocumentBudget({ matches: 1 })]) {
    expect(budget.limits.xmlNodes).toBe(Infinity);
    expect(budget.limits.work).toBe(Infinity);
    budget.charge("tableRows", 10_001);
  }
  expect(() => new DocumentBudget({ matches: 1 }).charge("matches", 2)).toThrow();
  expect(new DocumentBudget({ matches: 1 }).lower({ matches: 200_000 }).limits.matches).toBe(200_000);
});

it("removes hidden XML depth, attribute and namespace limits", () => {
  const xml = `<r ${Array.from({ length: 129 }, (_, i) => `a${i}="v"`).join(" ")}>${"<n>".repeat(257)}${"</n>".repeat(257)}</r>`;
  expect(parseDocumentXml(new TextEncoder().encode(xml)).root.name).toBe("r");
  expect(() => parseDocumentXml(new TextEncoder().encode(xml), { maxDepth: 2 })).toThrow();
});

it("admits archives with omitted or individual limits", async () => {
  const fixture = await createDocumentFixture("garden");
  for (const context of [modelContext(), modelContext({ limits: { maxMembers: 100 } as never })]) {
    expect(context.limits.maxEntryBytes).toBe(Infinity);
    expect((await readArchive(fixture.bytes, context)).members.length).toBeGreaterThan(0);
  }
  await expect(readArchive(fixture.bytes, modelContext({ limits: { maxMembers: 1 } as never }))).rejects.toThrow();
});
