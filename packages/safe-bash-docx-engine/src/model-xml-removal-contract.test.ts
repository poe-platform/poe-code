import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, StaleHandleError, SemanticValidationError } from "./index.js";
import { paragraph, textFixture, textContext } from "../tests/fixtures/text.js";

it("removes a selected model element successfully before invalidating its handles", async () => {
  const document = await Document(
    await textFixture(paragraph("Remove") + paragraph("Retain")),
    textContext
  );
  const selected = document.paragraphs[0]!,
    view = selected.element;
  const retained = document.paragraphs[1]!;
  view.remove();
  expect(() => selected.text).toThrow(StaleHandleError);
  expect(() => view.serialize()).toThrow(StaleHandleError);
  expect(retained.text).toBe("Retain");
  expect(document.paragraphs.map((p) => p.text)).toEqual(["Retain"]);
  const volume = Volume.fromJSON({ "/saved": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  const reopened = await Document(
    new Uint8Array(volume.readFileSync("/saved") as Buffer),
    textContext
  );
  expect(reopened.paragraphs.map((p) => p.text)).toEqual(["Retain"]);
});

it("rejects required body removal without detaching live document handles", async () => {
  const document = await Document(await textFixture(paragraph("Retain")), textContext);
  const before = document.store.snapshot();
  const selected = document.paragraphs[0]!;
  const body = document.element.children.find((node) => node.localName === "body")!;
  expect(() => body.remove()).toThrow(SemanticValidationError);
  expect(document.store.snapshot()).toEqual(before);
  expect(selected.text).toBe("Retain");
  expect(body.localName).toBe("body");
});

it("rejects removal of the required last table-cell paragraph before detaching it", async () => {
  const document = await Document(undefined, textContext);
  const selected = document.add_table(1, 1).cell(0, 0).paragraphs[0]!;
  const before = document.store.snapshot();
  expect(() => selected.element.remove()).toThrow(SemanticValidationError);
  expect(document.store.snapshot()).toEqual(before);
  expect(selected.text).toBe("");
});
