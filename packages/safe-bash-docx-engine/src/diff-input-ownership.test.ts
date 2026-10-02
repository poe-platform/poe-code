import { expect, it } from "vitest";
import { Volume } from "memfs";
import { compareDocument, DocumentBudget } from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { validateDocxInvocation } from "./command.js";
import { readArchive } from "./archive.js";

const limits = {
  maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536,
  maxMembers: 40, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024,
  maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 4096
};

it.each(["parts", "xml", "text", "structure"] as const)(
  "owns both comparison inputs before suspension in %s mode", async mode => {
    const { bytes } = await createDocumentFixture("museum");
    const volume = Volume.fromJSON({ "/left.docx": Buffer.from(bytes), "/right.docx": Buffer.from(bytes) });
    const before = volume.toJSON();
    const left = new Uint8Array(volume.readFileSync("/left.docx") as Uint8Array);
    const right = new Uint8Array(volume.readFileSync("/right.docx") as Uint8Array);
    const signal = new AbortController().signal;
    const pending = compareDocument(left, right, {
      limits, signal, budget: new DocumentBudget({}, signal, async () => {})
    }, { mode, scope: mode === "parts" || mode === "xml" ? "package" : "body" });
    left.fill(0);
    right.fill(0);
    await expect(pending).resolves.toMatchObject({ equal: true, differences: [] });
    expect(volume.toJSON()).toEqual(before);
  }
);

it.each(["left", "right"] as const)("admits the %s input ceiling before retaining comparison bytes", async side => {
  const { bytes } = await createDocumentFixture("museum");
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/output.docx": "Keep prior output" });
  const before = volume.toJSON();
  const input = new Uint8Array(volume.readFileSync("/input.docx") as Uint8Array);
  const over = new Uint8Array(input.length + 1);
  const signal = new AbortController().signal;
  const budget = new DocumentBudget({ compressedInput: input.length }, signal, async () => {});
  const admission = new DocumentBudget();
  validateDocxInvocation({ operation: "diff", inputs: ["left", "right"], options: { mode: "parts", scope: "package" } }, admission);
  await expect(compareDocument(side === "left" ? over : input, side === "right" ? over : input,
    { limits, signal, budget }, { mode: "parts", scope: "package" }))
    .rejects.toMatchObject({ code: "limit-exceeded" });
  expect(budget.usage.retainedBytes).toBe(admission.usage.retainedBytes);
  expect(budget.usage.compressedInput).toBe(0);
  expect(volume.toJSON()).toEqual(before);
});

it.each(["compressedInput", "expandedPackage", "zipEntries", "retainedBytes", "xmlNodes", "work"] as const)(
  "admits both comparison inputs at the exact %s boundary and rejects one less", async name => {
    const { bytes } = await createDocumentFixture("museum");
    const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/output.docx": "Retained output" });
    const before = volume.toJSON();
    const input = new Uint8Array(volume.readFileSync("/input.docx") as Uint8Array);
    const signal = new AbortController().signal;
    const baseline = new DocumentBudget({}, signal, async () => {});
    await compareDocument(input, input, { limits, signal, budget: baseline }, { mode: "parts", scope: "package" });
    const archive = await readArchive(input, { limits, signal });
    const ceiling = name === "compressedInput" ? input.length
      : name === "expandedPackage" ? archive.members.reduce((size, member) => size + member.bytes.length, 0)
      : name === "zipEntries" ? archive.members.length : baseline.usage[name];
    const exact = new DocumentBudget({ [name]: ceiling }, signal, async () => {});
    await expect(compareDocument(input, input, { limits, signal, budget: exact }, { mode: "parts", scope: "package" }))
      .resolves.toMatchObject({ equal: true, differences: [] });
    const over = new DocumentBudget({ [name]: ceiling - 1 }, signal, async () => {});
    await expect(compareDocument(input, input, { limits, signal, budget: over }, { mode: "parts", scope: "package" }))
      .rejects.toMatchObject({ code: "limit-exceeded" });
    expect(over.usage[name]).toBeLessThanOrEqual(name === "compressedInput" || name === "expandedPackage" || name === "zipEntries"
      ? (ceiling - 1) * 2 : ceiling - 1);
    expect(volume.toJSON()).toEqual(before);
  }
);
