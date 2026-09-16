import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Ajv } from "ajv";
import type { DocxSchemaData } from "./index.js";
import { createDocxInspectionCommandEngine, getDocxDiscovery } from "./index.js";
import { textFixture, paragraph, textContext, w } from "../tests/fixtures/text.js";

it("exposes XML view batch behavior and truthful result schemas through the public CLI", async () => {
  const input = await textFixture(paragraph("Coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/></w:style></w:styles>` } });
  const ref = (resultHandle: string) => ({ resultHandle });
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.element.get", receiver: ref("styles"), arguments: {}, resultHandle: "xml" },
    { operation: "model.XmlElementView.tag.get", receiver: ref("xml"), arguments: {} },
    { operation: "model.XmlElementView.attributes.get", receiver: ref("xml"), arguments: {} },
    { operation: "model.XmlElementView.text.get", receiver: ref("xml"), arguments: {} },
    { operation: "model.XmlElementView.text.set", receiver: ref("xml"), arguments: { value: "\n" } },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("xml"), arguments: {} }
  ];
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations }), "--dry-run", "--json"].map(arg => new TextEncoder().encode(arg)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(0);
  const envelope = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  expect(envelope).toMatchObject({ ok: true, affected: 1, data: { dryRun: true, output: [] } });
  const ajv = new Ajv({ strict: false });
  for (const item of envelope.data.results) {
    const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: item.operation } })!;
    const declaration = (schema.data as DocxSchemaData).operations[0]!;
    const validate = ajv.compile(declaration.result);
    expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
