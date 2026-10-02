import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { applyStyleModelBatch, executeDocumentBatch, Document } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const route of ["helper", "sdk"] as const)
it(`${route} binds model batch effects to the admitted bytes despite caller mutation; strict=${strict}`, async () => {
  const input = await textFixture(paragraph("Admitted coast"), {}, strict), original = input.slice();
  const volume = Volume.fromJSON({"/output": ""}), sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/output", bytes);}};
  const batch = {version: 1, operations: [
    {operation: "model.document.Document.paragraphs.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.element.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "element"},
    {operation: "model.XmlElementView.set_attribute.call", receiver: {resultHandle: "element"}, arguments: {name: {namespaceURI: "", localName: "audit"}, value: "retained"}}
  ]};
  const pending = route === "helper" ? applyStyleModelBatch(input, batch, textContext)
    : executeDocumentBatch(input, batch, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  input.fill(0);
  const result = await pending;
  const changes = "changes" in result ? result.changes : result.publication!.changes;
  const fingerprint = createHash("sha256").update(original).digest("hex");
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({before: {value: {sourceSha256: fingerprint}}, after: {value: {sourceSha256: fingerprint}}});
  if ("save" in result) await result.save(sink);
  expect((await Document(new Uint8Array(volume.readFileSync("/output") as Buffer), textContext)).paragraphs[0]!.text).toBe("Admitted coast");
});
