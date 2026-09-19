import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { getDocxOperationSchema, docxValueSchema } from "./operation-json-schema.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
it("publishes native primitive result references in scoped and full batch schemas", () => {
  const args = { rId: ref("pair", 0) };
  const typed: api.DocxBatchItem = { operation: "model.parts.document.DocumentPart.target_ref.call", receiver: ref("main"), arguments: { rId: ref("pair", 0) } };
  expect(typed.arguments).toEqual(args);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.compile(getDocxOperationSchema(typed.operation, "batch"))(args)).toBe(true);
  const batch = docxValueSchema("BatchV1"), items = batch.properties!.operations!.items;
  const item = items && items.oneOf!.find(item => item.properties!.operation!.const === typed.operation)!;
  expect(item).toBeTruthy();
  expect(ajv.compile({ ...item, $defs: batch.$defs })(typed)).toBe(true);
  expect(ajv.compile(getDocxOperationSchema(typed.operation))(args)).toBe(false);
});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const) for (const selected of ["image", "relationship"] as const)
it(`${route} consumes the native image tuple ${selected} with retained ownership; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Harbor ledger</w:t></w:r></w:p>');
  const raster = rasterPng(), before = readPackage(input), memory = Volume.fromJSON({ "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  let value: unknown;
  if (route === "model") {
    const doc = await api.Document(input, textContext), pair = await doc.part.get_or_add_image(raster);
    value = selected === "image" ? pair[1].px_width : doc.part.target_ref(pair[0]);
    await doc.save(sink);
  } else {
    const operations = [
      { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
      { operation: "model.parts.document.DocumentPart.get_or_add_image.call", receiver: ref("main"), arguments: { imageDescriptor: { kind: "bytes", base64: Buffer.from(raster).toString("base64") } }, resultHandle: "pair" },
      selected === "image"
        ? { operation: "model.image.image.Image.px_width.get", receiver: ref("pair", 1), arguments: {} }
        : { operation: "model.parts.document.DocumentPart.target_ref.call", receiver: ref("main"), arguments: { rId: ref("pair", 0) } }
    ];
    if (route === "sdk") {
      const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
      value = result.results.at(-1)!.value; await result.save(sink);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0); value = JSON.parse(result.stdout).data.results.at(-1).data;
        memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect(value).toBe(selected === "image" ? 1 : "media/image1.png");
  expect(after.get("word/media/image1.png")).toEqual(raster);
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && name !== "word/_rels/document.xml.rels") expect(after.get(name), name).toEqual(bytes);
});

for (const scenario of ["wrong-item", "negative", "fraction", "past-end", "key", "unknown-field", "forward", "wrong-primitive"] as const)
it(`rejects ${scenario} native result references before publication`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", false, "docx", "<w:p/>");
  const reference = scenario === "wrong-item" ? ref("pair", 1) : scenario === "negative" ? ref("pair", -1) : scenario === "fraction" ? ref("pair", 0.5) : scenario === "past-end" ? ref("pair", 2) : scenario === "key" ? { resultHandle: "pair", key: "0" } : scenario === "unknown-field" ? { ...ref("pair", 0), hidden: true } : scenario === "forward" ? ref("later") : ref("size");
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.get_or_add_image.call", receiver: ref("main"), arguments: { imageDescriptor: { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") } }, resultHandle: "pair" },
    ...(scenario === "wrong-primitive" ? [{ operation: "model.parts.document.DocumentPart.next_id.get", receiver: ref("main"), arguments: {}, resultHandle: "size" }] : []),
    { operation: "model.parts.document.DocumentPart.target_ref.call", receiver: ref("main"), arguments: { rId: reference } }
  ];
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("owned sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode).toBe(scenario === "past-end" ? 1 : 2); expect(JSON.parse(result.stdout).errors[0].code).toBe(scenario === "past-end" ? "missing-selection" : "usage");
    if (scenario === "past-end") expect(JSON.parse(result.stdout).errors[0].operationIndex).toBe(2);
    expect(await fs.readFile("/output")).toEqual(enc("owned sentinel")); expect(await fs.readFile("/input")).toEqual(input);
  } finally { await shell.dispose(); }
});
