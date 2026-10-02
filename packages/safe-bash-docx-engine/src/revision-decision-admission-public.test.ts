import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentBudget } from "./index.js";
import { editDocumentRevisionDecisions } from "./revision-decisions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const action of ["accept", "reject"] as const)
it(`admits one immutable package for an opaque revision refusal; strict=${strict}; kind=${kind}; action=${action}`, async () => {
  const input = await textFixture('<w:p><w:ins w:id="1"><w:r><w:t>Bay</w:t><f:opaque xmlns:f="urn:decision:opaque"/></w:r></w:ins></w:p>', {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "Retained destination" });
  const budget = new DocumentBudget({}, textContext.signal);
  await expect(editDocumentRevisionDecisions(new Uint8Array(memory.readFileSync("/input") as Buffer),
    { operation: `revisions.${action}`, options: { all: true, output: "-" } },
    { ...textContext, budget, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } }
  )).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(memory.readFileSync("/output", "utf8")).toBe("Retained destination");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(budget.usage.compressedInput).toBe(input.length);
});
