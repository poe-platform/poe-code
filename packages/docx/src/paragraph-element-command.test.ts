import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  docxOperationSchemas,
  getDocxDiscovery,
  type DocxSchemaData,
  type DocxOperationArguments,
  type DocxBatchItem
} from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";

const operation = "model.text.paragraph.Paragraph.element.get";

it("declares bounded paragraph XML access as a nonmutating typed batch operation", () => {
  expect(Reflect.get(docxOperationSchemas, operation)).toMatchObject({
    receiver: "Paragraph",
    mutates: false,
    transport: "typed-batch",
    valueType: "XmlElementView",
    resultHandle: { allowed: true, type: "XmlElementView" }
  });
});

it("discovers a readable XML getter and its returned handle schema", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!
    .data as DocxSchemaData;
  expect(data.operations).toHaveLength(1);
  expect(data.operations[0]).toMatchObject({
    id: operation,
    path: ["batch"],
    support: "read",
    result: { properties: { value: { properties: { type: { const: "XmlElementView" } } } } }
  });
});

it("uses the returned paragraph XML handle through public SDK and CLI", async () => {
  const input = await textFixture(paragraph("Remove") + paragraph("Retain 🌊"));
  const direct = await Document(input, textContext);
  expect(direct.paragraphs[0]!.element.tag).toEqual({ namespaceURI: w, localName: "p" });
  direct.paragraphs[0]!.element.remove();
  expect(direct.paragraphs.map((p) => p.text)).toEqual(["Retain 🌊"]);
  const getter = {
    operation,
    receiver: { resultHandle: "paragraphs", index: 0 },
    arguments: {} satisfies DocxOperationArguments<typeof operation>,
    resultHandle: "xml"
  } satisfies DocxBatchItem;
  const batch = {
    version: 1,
    operations: [
      {
        operation: "model.document.Document.paragraphs.get",
        receiver: { resultHandle: "document" },
        arguments: {},
        resultHandle: "paragraphs"
      },
      getter,
      {
        operation: "model.XmlElementView.tag.get",
        receiver: { resultHandle: "xml" },
        arguments: {}
      },
      {
        operation: "model.XmlElementView.remove.call",
        receiver: { resultHandle: "xml" },
        arguments: {}
      }
    ]
  };
  const sdk = await applyStyleModelBatch(input, batch, textContext);
  expect(sdk.results[2]!.value).toEqual({ namespaceURI: w, localName: "p" });
  const volume = Volume.fromJSON({
    "/input": Buffer.from(input),
    "/sdk": "",
    "/cli": "",
    "/err": ""
  });
  await sdk.save({
    async write(bytes) {
      volume.appendFileSync("/sdk", bytes);
    }
  });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify(batch), "--output", "-"].map((arg) =>
      new TextEncoder().encode(arg)
    ),
    cwd: "/",
    signal: textContext.signal,
    filesystem: {
      async readFile(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      }
    },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: {
      async write(bytes) {
        volume.appendFileSync("/cli", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        volume.appendFileSync("/err", bytes);
      }
    }
  });
  expect(volume.readFileSync("/err", "utf8")).toBe("");
  expect(result.exitCode).toBe(0);
  for (const path of ["/sdk", "/cli"]) {
    const reopened = await Document(
      new Uint8Array(volume.readFileSync(path) as Buffer),
      textContext
    );
    expect(reopened.paragraphs.map((p) => p.text)).toEqual(["Retain 🌊"]);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

it("rejects invalid XML getter arguments and document receivers before mutation", async () => {
  const input = await textFixture(paragraph("Retain"));
  const before = new Uint8Array(input);
  for (const item of [
    { operation, receiver: { resultHandle: "document" }, arguments: {} },
    { operation, receiver: { resultHandle: "paragraphs", index: 0 }, arguments: { path: "/host" } }
  ]) {
    await expect(
      applyStyleModelBatch(
        input,
        {
          version: 1,
          operations: [
            {
              operation: "model.document.Document.paragraphs.get",
              receiver: { resultHandle: "document" },
              arguments: {},
              resultHandle: "paragraphs"
            },
            item
          ]
        },
        textContext
      )
    ).rejects.toMatchObject({ code: "usage", exitCode: 2 });
    expect(input).toEqual(before);
  }
});
