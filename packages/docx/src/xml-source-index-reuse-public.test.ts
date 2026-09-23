import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime as unknown as typeof compiledTypes;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const runtime of ["source", "native"] as const)
for (const scenario of ["reservations", "isolated-patches", "changed-bytes", "cancellation", "work-refusal", "retention-refusal"] as const)
it(`immutable XML source index public boundary; strict=${strict}; kind=${kind}; runtime=${runtime}; scenario=${scenario}`, async () => {
  const product: typeof api = runtime === "native" ? native as unknown as typeof api : api;
  expect(native.Document).not.toBe(api.Document);
  const memory = Volume.fromJSON({ "/input": Buffer.from(await textFixture('<w:p><w:r><w:t>InitialA</w:t></w:r></w:p>', {}, strict, { kind })), "/output": "" });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const budget = new product.DocumentBudget({ work: 512 * 1024 * 1024, retainedBytes: 512 * 1024 * 1024 }, textContext.signal), context = { ...textContext, budget };
  const document = await product.Document(input, context);
  const xml = readPackage(input).get("word/document.xml")!, bytes = xml.slice();
  const before = budget.usage;
  const first = new product.DocumentXmlEditor(xml, {}, undefined, budget);
  const after = budget.usage;
  const cost = { work: after.work - before.work, retainedBytes: after.retainedBytes - before.retainedBytes, xmlNodes: after.xmlNodes - before.xmlNodes };
  expect(cost.work).toBeGreaterThan(0); expect(cost.retainedBytes).toBeGreaterThan(0);
  if (scenario === "cancellation") {
    const controller = new AbortController(), cancelled = budget.lower({}, controller.signal); controller.abort();
    expect(() => new product.DocumentXmlEditor(xml, {}, undefined, cancelled)).toThrowError(expect.objectContaining({ code: "cancelled" }));
  } else if (scenario === "work-refusal" || scenario === "retention-refusal") {
    const resource = scenario === "work-refusal" ? "work" : "retainedBytes";
    budget.charge(resource, budget.limits[resource] - budget.usage[resource] - cost[resource] + 1);
    expect(() => new product.DocumentXmlEditor(xml, {}, undefined, budget)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  } else {
    const start = budget.usage;
    const second = new product.DocumentXmlEditor(xml, {}, undefined, budget);
    expect(second.root).toBe(first.root);
    const end = budget.usage;
    expect({ work: end.work - start.work, retainedBytes: end.retainedBytes - start.retainedBytes, xmlNodes: end.xmlNodes - start.xmlNodes }).toEqual(cost);
    expect(second.serialize()).toEqual(bytes);
    if (scenario === "isolated-patches") {
      const leaf = first.root.children[0]!.children[0]!.children[0]!.children[0]!;
      first.setText(leaf.content[0]!, "EditedA");
      expect(new TextDecoder().decode(first.serialize())).toContain("EditedA");
      expect(second.serialize()).toEqual(bytes); expect(second.dirtyNodes).toEqual([]);
    } else if (scenario === "changed-bytes") {
      const changed = new TextEncoder().encode(new TextDecoder().decode(xml).replace("InitialA", "InitialB"));
      expect(changed.length).toBe(xml.length);
      const third = new product.DocumentXmlEditor(changed, {}, undefined, budget);
      expect(third.root).not.toBe(first.root); expect(third.serialize()).toEqual(changed);
      expect(new TextDecoder().decode(third.serialize())).toContain("InitialB"); expect(second.serialize()).toEqual(bytes);
    }
    await document.save({ async write(chunk) { memory.appendFileSync("/output", chunk); } });
    expect(Buffer.compare(memory.readFileSync("/output") as Buffer, Buffer.from(input))).toBe(0);
  }
  expect(xml).toEqual(bytes); expect(input).toEqual(original);
  expect(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(original))).toBe(0);
});
