import { expect, it } from "vitest";
import { Volume } from "memfs";
import { applyStyleModelBatch, createDocxInspectionCommandEngine, openDocumentStyleModel, WD_STYLE_TYPE } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it.each([false, true])("counts definition creation once and existing definition reads zero times with an earlier value operation: %s", async earlierValue => {
  const input = await textFixture(paragraph("Tidal record"));
  const batch = { version: 1, operations: [
    ...(earlierValue ? [{ operation: "model.shared.Pt.call", arguments: { points: 12 } }] : []),
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.latent_styles.get", receiver: { resultHandle: "styles" }, arguments: {}, resultHandle: "latent" },
    { operation: "model.styles.styles.Styles.latent_styles.get", receiver: { resultHandle: "styles" }, arguments: {} }
  ] };
  const created = await applyStyleModelBatch(input, batch, textContext);
  expect(created.affected).toBe(2);
  const volume = Volume.fromJSON({ "/saved": "" });
  await created.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
  const saved = new Uint8Array(volume.readFileSync("/saved") as Buffer);
  const reopened = await applyStyleModelBatch(saved, batch, textContext);
  expect(reopened.affected).toBe(0);
  const model = await openDocumentStyleModel(saved, textContext);
  expect(model.styles.latent_styles.length).toBe(0);
});

it("identifies a stored style by name, ID and type consistently through public model, SDK and CLI without changing the document", async () => {
  const source = await textFixture(paragraph("Estuary observations"));
  const authored = await openDocumentStyleModel(source, textContext);
  authored.styles.add_style("Estuary notes", WD_STYLE_TYPE.PARAGRAPH);
  const volume = Volume.fromJSON({ "/input.docx": "", "/stdout": "", "/stderr": "" });
  await authored.save({ async write(bytes) { volume.appendFileSync("/input.docx", bytes); } });
  const input = new Uint8Array(volume.readFileSync("/input.docx") as Buffer);
  const model = await openDocumentStyleModel(input, textContext);
  const style = model.styles.at("Estuary notes");
  const expected = ["Estuary notes", "Style1", WD_STYLE_TYPE.PARAGRAPH];
  expect([style.name, style.style_id, style.type]).toEqual(expected);

  const operations = [
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: { resultHandle: "styles" }, arguments: { key: "Estuary notes" }, resultHandle: "style" },
    ...["name", "style_id", "type"].map(name => ({ operation: `model.styles.style.BaseStyle.${name}.get`, receiver: { resultHandle: "style" }, arguments: {} }))
  ];
  const batch = { version: 1, operations };
  const applied = await applyStyleModelBatch(input, batch, textContext);
  expect(applied.results.slice(2).map(result => result.value)).toEqual(expected);
  expect(applied.affected).toBe(0);

  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify(batch), "--dry-run", "--json"].map(arg => new TextEncoder().encode(arg)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(0);
  const output = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  expect(output).toMatchObject({ version: 1, operation: "batch", ok: true, affected: 0, errors: [], data: { output: [] } });
  expect(output.data.results.slice(2).map((item: { value: unknown }) => item.value)).toEqual(expected);
  expect(volume.readFileSync("/stderr", "utf8")).toBe("");
  expect(new Uint8Array(volume.readFileSync("/input.docx") as Buffer)).toEqual(input);
});
