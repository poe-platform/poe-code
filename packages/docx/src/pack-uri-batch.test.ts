import type { DocxSchemaData } from "./discovery.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { applyStyleModelBatch } from "./index.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

const prefix = "model.opc.packuri.PackURI";
const construct = { operation: `${prefix}.call`, arguments: { packUriStr: "/reports/page1.xml" }, resultHandle: "uri" };
const receiver = { resultHandle: "uri" };
it.each([
  ["baseURI.get", {}, "/reports"],
  ["ext.get", {}, "xml"],
  ["filename.get", {}, "page1.xml"],
  ["idx.get", {}, 1],
  ["membername.get", {}, "reports/page1.xml"],
  ["relative_ref.call", { baseURI: "/other" }, "../reports/page1.xml"],
  ["rels_uri.get", {}, "/reports/_rels/page1.xml.rels"],
  ["string_protocol.call", {}, "/reports/page1.xml"]
])("executes checked package URI batch member %s", async (member, args, expected) => {
  const input = await textFixture(paragraph("Survey"));
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [construct, { operation: `${prefix}.${member}`, receiver, arguments: args }] }, textContext);
  expect(applied.results[0]?.value).toBe("/reports/page1.xml");
  expect(applied.results[1]?.value).toBe(expected);
  expect(applied.affected).toBe(0);
});
it("constructs a relative package URI without an instance receiver", async () => {
  const applied = await applyStyleModelBatch(await textFixture(paragraph("Survey")), { version: 1, operations: [
    { operation: `${prefix}.from_rel_ref.call`, arguments: { baseURI: "/reports", relativeRef: "../assets/image1.xml" } }
  ] }, textContext);
  expect(applied.results[0]?.value).toBe("/assets/image1.xml");
});
it("retains returned relationship URI values as usable checked receivers", async () => {
  const applied = await applyStyleModelBatch(await textFixture(paragraph("Survey")), { version: 1, operations: [construct,
    { operation: `${prefix}.rels_uri.get`, receiver, arguments: {}, resultHandle: "rels" },
    { operation: `${prefix}.filename.get`, receiver: { resultHandle: "rels" }, arguments: {} }
  ] }, textContext);
  expect(applied.results[2]?.value).toBe("page1.xml.rels");
});
it("rejects literal guessed package URI receivers", async () => {
  await expect(applyStyleModelBatch(await textFixture(paragraph("Survey")), { version: 1, operations: [construct,
    { operation: `${prefix}.filename.get`, receiver: { id: "uri", type: "PackURI", owner: "batch", revision: 0 }, arguments: {} }
  ] }, textContext)).rejects.toThrow();
});
it("uses SDK package URI operations through CLI JSON without document publication", async () => {
  const input = await textFixture(paragraph("Survey"));
  const fs = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
  const batch = { version: 1, operations: [construct, { operation: `${prefix}.baseURI.get`, receiver, arguments: {} }] };
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify(batch), "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(fs.readFileSync(path) as Uint8Array); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { fs.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode).toBe(0);
  expect(fs.readFileSync("/err", "utf8")).toBe("");
  expect(JSON.parse(fs.readFileSync("/out", "utf8") as string)).toMatchObject({ version: 1, operation: "batch", ok: true, affected: 0, data: { output: [], results: [{ value: "/reports/page1.xml" }, { value: "/reports" }] } });
  expect(new Uint8Array(fs.readFileSync("/input.docx") as Uint8Array)).toEqual(input);
});
it("describes immutable package URI results as strings and package feature reads", async () => {
  const { styleModelOperationResultSchema } = await import("./style-model-result-schema.js");
  const { getDocxDiscovery } = await import("./discovery.js");
  expect(styleModelOperationResultSchema(`${prefix}.call`).properties?.value).toEqual({ type: "string" });
  const discovery = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!;
  const data = discovery.data as DocxSchemaData;
  expect(data.operations.find(item => item.id === `${prefix}.call`)).toMatchObject({ featureIds: ["F01"], support: "read" });
});
