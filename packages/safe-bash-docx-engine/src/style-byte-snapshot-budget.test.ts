import { expect, it } from "vitest";
import { DocumentBudget, openDocumentStyleModel } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

it("refuses a standalone style byte snapshot after invocation work is exhausted", async () => {
  const input = await textFixture('<w:p/>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/></w:style></w:styles>`}});
  const budget = new DocumentBudget({work: 1_000_000});
  const model = await openDocumentStyleModel(input, {...textContext, budget});
  const part = model.styles.at("Coast").part;
  expect(part.blob.byteLength).toBeGreaterThan(0);
  budget.charge("work", budget.limits.work - budget.usage.work);
  expect(() => part.blob).toThrowError(expect.objectContaining({code: "limit-exceeded"}));
});
