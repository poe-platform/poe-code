import { expect, expectTypeOf, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  WD_PARAGRAPH_ALIGNMENT,
  applyStyleModelBatch,
  editDocumentParagraphs,
  createDocxInspectionCommandEngine,
  assertDocxFields,
  docxOperationSchemas,
  getDocxOperationSchema,
  parseDocxArguments,
  type DocxOperationArguments,
  type DocxBatchArgumentMap,
  type DocxBatchItem,
  type DocxEnumValue,
  type DocxSchemaData
} from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const setter = "model.text.paragraph.Paragraph.alignment.set";
const paragraph = { resultHandle: "paragraphs", index: 0 };
const getParagraphs = {
  operation: "model.document.Document.paragraphs.get",
  receiver: { resultHandle: "document" },
  arguments: {},
  resultHandle: "paragraphs"
} satisfies DocxBatchItem;
const centered = { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" } as const;
const alignments = [
  ["LEFT", "left"],
  ["CENTER", "center"],
  ["RIGHT", "right"],
  ["JUSTIFY", "both"],
  ["DISTRIBUTE", "distribute"],
  ["JUSTIFY_MED", "mediumKashida"],
  ["JUSTIFY_HI", "highKashida"],
  ["JUSTIFY_LOW", "lowKashida"],
  ["THAI_JUSTIFY", "thaiDistribute"]
] as const;

function batch(value: unknown) {
  return {
    version: 1,
    operations: [
      getParagraphs,
      { operation: setter, receiver: paragraph, arguments: { value } },
      {
        operation: "model.text.paragraph.Paragraph.alignment.get",
        receiver: paragraph,
        arguments: {}
      }
    ]
  };
}

async function fixture(strict = false) {
  return textFixture(
    '<w:p><w:pPr><w:pStyle w:val="Survey"/><w:keepNext w:val="0"/></w:pPr><w:r><w:t>Coastal observations</w:t></w:r></w:p>',
    {
      styles: {
        kind: "styles",
        xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Survey"><w:name w:val="Survey"/><w:pPr><w:jc w:val="${strict ? "end" : "right"}"/></w:pPr></w:style></w:styles>`
      }
    },
    strict
  );
}

async function cli(input: Uint8Array, words: string[], operations = batch(null)) {
  const volume = Volume.fromJSON({
    "/input.docx": Buffer.from(input),
    "/ops.json": JSON.stringify(operations),
    "/stdout": "",
    "/stderr": ""
  });
  const write = vi.fn(async (bytes: Uint8Array) => {
    volume.appendFileSync("/stdout", bytes);
  });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: words.map((word) => new TextEncoder().encode(word)),
    cwd: "/",
    signal: textContext.signal,
    filesystem: {
      async readFile(path) {
        return new Uint8Array(volume.readFileSync(path) as Uint8Array);
      }
    },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { write },
    stderr: {
      async write(bytes) {
        volume.appendFileSync("/stderr", bytes);
      }
    }
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  return {
    ...result,
    write,
    bytes: new Uint8Array(volume.readFileSync("/stdout") as Uint8Array),
    stderr: volume.readFileSync("/stderr", "utf8") as string
  };
}

it("admits null in both public transport types while retaining required enum identity", () => {
  type Alignment = DocxEnumValue<"WD_PARAGRAPH_ALIGNMENT"> | null;
  expectTypeOf<DocxOperationArguments<typeof setter>["value"]>().toEqualTypeOf<Alignment>();
  expectTypeOf<DocxBatchArgumentMap[typeof setter]["value"]>().toEqualTypeOf<Alignment>();
  const reset: DocxBatchItem = {
    operation: setter,
    receiver: paragraph,
    arguments: { value: null }
  };
  expect(reset.arguments).toEqual({ value: null });
  expectTypeOf<
    DocxOperationArguments<"model.text.tabstops.TabStop.alignment.set">["value"]
  >().toEqualTypeOf<DocxEnumValue<"WD_TAB_ALIGNMENT">>();
  // @ts-expect-error A reset is explicit; undefined is not a required value.
  const omitted: DocxOperationArguments<typeof setter> = { value: undefined };
  // @ts-expect-error False is not paragraph alignment inheritance.
  const disabled: DocxBatchArgumentMap[typeof setter] = { value: false };
  const malformed: DocxOperationArguments<typeof setter> = {
    // @ts-expect-error Enum symbols remain closed.
    value: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "MIDDLE" }
  };
  expect([omitted.value, disabled.value, malformed.value]).toHaveLength(3);
});

for (const strict of [false, true]) {
  it.each(
    alignments.flatMap(([name, xmlValue]) =>
      (["model", "sdk", "sdk-direct", "cli-json", "cli-file", "cli-direct"] as const).map(
        (route) => ({ route, name, xmlValue })
      )
    )
  )(
    `$route saves and repeatedly resets $name with inherited style retained (${strict ? "Strict" : "Transitional"})`,
    async ({ route, name, xmlValue }) => {
      const original = await fixture(strict);
      let bytes = original;
      for (const value of [null, WD_PARAGRAPH_ALIGNMENT[name], null, null]) {
        const volume = Volume.fromJSON({ "/saved.docx": "" });
        const sink = {
          async write(chunk: Uint8Array) {
            volume.appendFileSync("/saved.docx", chunk);
          }
        };
        if (route === "model") {
          const document = await Document(bytes, textContext);
          document.paragraphs[0]!.alignment = value;
          expect(document.paragraphs[0]!.alignment).toEqual(value);
          await document.save(sink);
          bytes = new Uint8Array(volume.readFileSync("/saved.docx") as Uint8Array);
        } else if (route === "sdk") {
          const edited = await applyStyleModelBatch(bytes, batch(value), textContext);
          expect(edited.results.at(-1)?.value).toEqual(value);
          await edited.save(sink);
          bytes = new Uint8Array(volume.readFileSync("/saved.docx") as Uint8Array);
        } else if (route === "sdk-direct") {
          await editDocumentParagraphs(
            bytes,
            {
              operation: "paragraphs.set",
              options: { paragraph: 1, alignment: value, output: "-" }
            },
            { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink }
          );
          bytes = new Uint8Array(volume.readFileSync("/saved.docx") as Uint8Array);
        } else {
          const words =
            route === "cli-direct"
              ? [
                  "paragraphs",
                  "set",
                  "input.docx",
                  "--paragraph",
                  "1",
                  "--alignment",
                  value?.name ?? "null"
                ]
              : [
                  "batch",
                  "input.docx",
                  ...(route === "cli-file"
                    ? ["--ops-file", "/ops.json"]
                    : ["--ops-json", JSON.stringify(batch(value))])
                ];
          const result = await cli(bytes, [...words, "--output", "-"], batch(value));
          expect(result.exitCode, result.stderr).toBe(0);
          expect(result.stderr).toBe("");
          expect(result.write).toHaveBeenCalledTimes(1);
          bytes = result.bytes;
        }
        const reloaded = await Document(bytes, textContext);
        expect(reloaded.paragraphs[0]!.alignment).toEqual(value);
        expect(reloaded.paragraphs[0]!.paragraph_format.keep_with_next).toBe(false);
        expect(reloaded.paragraphs[0]!.style!.paragraph_format.alignment).toEqual({
          enum: "WD_PARAGRAPH_ALIGNMENT",
          name: "RIGHT"
        });
        const actual = readPackage(bytes),
          baseline = readPackage(original);
        for (const [name, payload] of baseline) {
          if (name !== "word/document.xml") expect(actual.get(name), name).toEqual(payload);
        }
        const xml = xmlStructure(actual.get("word/document.xml")!);
        const expectedXml = new TextDecoder().decode(baseline.get("word/document.xml"));
        const lexical =
          strict && name === "LEFT" ? "start" : strict && name === "RIGHT" ? "end" : xmlValue;
        const expected =
          value === null
            ? expectedXml
            : expectedXml.replace("</w:pPr>", `<w:jc w:val="${lexical}"/></w:pPr>`);
        expect(xml).toEqual(xmlStructure(new TextEncoder().encode(expected)));
      }
    }
  );
}

const invalid = [
  undefined,
  false,
  0,
  "CENTER",
  { enum: "WD_PARAGRAPH_ALIGNMENT", name: "MIDDLE" },
  { enum: "WD_TAB_ALIGNMENT", name: "CENTER" },
  { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER", extra: true }
];
it.each(invalid)(
  "rejects invalid alignment %j without model mutation or SDK/CLI publication",
  async (value) => {
    const input = await fixture();
    const document = await Document(input, textContext);
    document.paragraphs[0]!.alignment = centered;
    const before = document.element.serialize();
    expect(() => {
      document.paragraphs[0]!.alignment = value as never;
    }).toThrow();
    expect(document.element.serialize()).toEqual(before);
    const sink = vi.fn();
    const operations = batch(value);
    operations.operations.splice(1, 0, {
      operation: setter,
      receiver: paragraph,
      arguments: { value: centered }
    });
    await expect(
      (async () => {
        const edited = await applyStyleModelBatch(input, operations, textContext);
        await edited.save({ write: sink });
      })()
    ).rejects.toMatchObject({ code: "usage" });
    expect(sink).not.toHaveBeenCalled();
    for (const option of [
      ["--ops-json", JSON.stringify(operations)],
      ["--ops-file", "/ops.json"]
    ]) {
      const result = await cli(
        input,
        ["batch", "input.docx", ...option, "--output", "-"],
        operations
      );
      expect(result.exitCode).toBe(2);
      expect(result.bytes).toHaveLength(0);
      expect(result.write).not.toHaveBeenCalled();
    }
  }
);

it("derives nullable closed schemas, parser input, and generated help from the operation declaration", async () => {
  const declaration = docxOperationSchemas[setter]!;
  for (const fields of [declaration.fields, declaration.sdkFields, declaration.batchFields!]) {
    expect(fields.value).toEqual({ type: "WD_PARAGRAPH_ALIGNMENT | null", required: true });
    expect(() => assertDocxFields(fields, { value: null })).not.toThrow();
    expect(() => assertDocxFields(fields, {})).toThrow();
    for (const value of invalid) expect(() => assertDocxFields(fields, { value })).toThrow();
  }
  const enumSchema = {
    type: "object",
    properties: {
      enum: { const: "WD_PARAGRAPH_ALIGNMENT" },
      name: {
        enum: [
          "LEFT",
          "CENTER",
          "RIGHT",
          "JUSTIFY",
          "DISTRIBUTE",
          "JUSTIFY_MED",
          "JUSTIFY_HI",
          "JUSTIFY_LOW",
          "THAI_JUSTIFY"
        ]
      }
    },
    required: ["enum", "name"],
    additionalProperties: false
  };
  for (const surface of ["cli", "sdk", "batch"] as const) {
    const schema = getDocxOperationSchema(setter, surface);
    expect(schema.properties?.value).toEqual({ anyOf: [enumSchema, { type: "null" }] });
    expect(schema.required).toContain("value");
  }
  const parsed = parseDocxArguments(
    ["batch", "input.docx", "--ops-json", JSON.stringify(batch(null)), "--output", "-"].map(
      (word) => new TextEncoder().encode(word)
    )
  );
  expect(parsed.options.operations).toEqual(batch(null).operations);
  const help = await cli(new Uint8Array(), ["help", "batch", "--operation", setter]);
  expect(help.exitCode, help.stderr).toBe(0);
  expect(new TextDecoder().decode(help.bytes)).toContain("WD_PARAGRAPH_ALIGNMENT | null");
  const discovery = await cli(new Uint8Array(), ["schema", "batch", "--operation", setter]);
  expect(discovery.exitCode, discovery.stderr).toBe(0);
  const data = JSON.parse(new TextDecoder().decode(discovery.bytes)).data as DocxSchemaData;
  expect(data.operations).toHaveLength(1);
  expect(data.operations[0]).toMatchObject({
    id: setter,
    support: "edit",
    input: { properties: { value: { anyOf: [enumSchema, { type: "null" }] } } }
  });
});

it("retains neighboring nonnullable setters and distinct false/null/undefined formatting states", () => {
  for (const operation of [
    "model.text.tabstops.TabStop.alignment.set",
    "model.opc.coreprops.CoreProperties.revision.set"
  ]) {
    for (const fields of [
      docxOperationSchemas[operation]!.fields,
      docxOperationSchemas[operation]!.sdkFields,
      docxOperationSchemas[operation]!.batchFields!
    ]) {
      expect(() => assertDocxFields(fields, { value: null })).toThrow();
      expect(() => assertDocxFields(fields, { value: undefined })).toThrow();
    }
  }
  const bold = docxOperationSchemas["model.text.run.Run.bold.set"]!.batchFields!;
  for (const value of [true, false, null])
    expect(() => assertDocxFields(bold, { value })).not.toThrow();
  expect(() => assertDocxFields(bold, { value: undefined })).toThrow();
  expect(() =>
    assertDocxFields(
      docxOperationSchemas["model.text.paragraph.Paragraph.text.set"]!.batchFields!,
      { value: null }
    )
  ).not.toThrow();
  expect(() =>
    assertDocxFields(docxOperationSchemas["paragraphs.set"]!.sdkFields, { alignment: undefined })
  ).not.toThrow();
});
