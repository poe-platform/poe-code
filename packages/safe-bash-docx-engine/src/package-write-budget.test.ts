import { afterEach, expect, it, vi } from "vitest";
import { DocumentArchiveEditor } from "./package-write.js";
import { DocumentBudget } from "./budget.js";
import { readDocumentArchive } from "./admission.js";
import * as validation from "./validation.js";
import { equationContext, equationFixture } from "../tests/fixtures/equations.js";

afterEach(() => vi.restoreAllMocks());

it("inherits snapshot validation ceilings without introducing a standalone profile", async () => {
  const archive = await readDocumentArchive(await equationFixture(), equationContext);
  const budget = new DocumentBudget({ xmlNodes: 10_000_000, expandedPackage: 64 * 1024 * 1024, zipEntries: 5000 });
  const validate = vi.spyOn(validation, "validateDocumentArchive");
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  expect(editor.snapshot().members).toHaveLength(archive.members.length);
  expect(validate).toHaveBeenCalledTimes(1);
  expect(validate.mock.calls[0]![1]).toEqual({
    maxNodes: 10_000_000, maxBytes: 64 * 1024 * 1024, maxParts: 5000
  });
  expect(validate.mock.calls[0]![2]).toBe(budget);
});

it("honors caller-lowered snapshot validation ceilings", async () => {
  const archive = await readDocumentArchive(await equationFixture(), equationContext);
  const budget = new DocumentBudget().lower({ xmlNodes: 1000, expandedPackage: 16384, zipEntries: 10 });
  const validate = vi.spyOn(validation, "validateDocumentArchive");
  new DocumentArchiveEditor(archive, { maxNodes: 500 }, undefined, budget).snapshot();
  expect(validate).toHaveBeenCalledTimes(1);
  expect(validate.mock.calls[0]![1]).toEqual({ maxNodes: 500, maxBytes: 16384, maxParts: 10 });
  expect(validate.mock.calls[0]![2]).toBe(budget);
});

it("retains staged semantic validation and cumulative node reservations", async () => {
  const archive = await readDocumentArchive(await equationFixture(), equationContext);
  const invalid = { ...archive, members: archive.members.filter(member => member.name !== "_rels/.rels") };
  expect(() => new DocumentArchiveEditor(invalid).snapshot()).toThrowError(validation.SemanticValidationError);
  const budget = new DocumentBudget({ xmlNodes: 1000 });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  budget.charge("xmlNodes", 1000);
  expect(() => editor.snapshot()).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
});
