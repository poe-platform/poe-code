import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { Ajv } from "ajv";
import { Volume } from "memfs";
import {
  Document,
  Paragraph,
  XmlElementView,
  StaleHandleError,
  BoundsError,
  DocumentBudget,
  ResourceLimitError,
  CancellationError,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  getDocxDiscovery,
  readArchive,
  validateDocxBatch,
  type DocxSchemaData,
  type DocxBatchItemMap,
  type DocxBatchArgumentMap,
  type DocxOperationArguments
} from "./index.js";
import { DocxUsageError } from "./argument-json.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { paragraph, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

const getter = "model.text.paragraph.Paragraph.element.get";
const ref = (resultHandle: string, index?: number) =>
  index === undefined ? { resultHandle } : { resultHandle, index };
const select = [
  {
    operation: "model.document.Document.paragraphs.get",
    receiver: ref("document"),
    arguments: {},
    resultHandle: "paragraphs"
  },
  { operation: getter, receiver: ref("paragraphs", 1), arguments: {}, resultHandle: "element" }
];
const read = [
  ...select,
  { operation: "model.XmlElementView.tag.get", receiver: ref("element"), arguments: {} },
  { operation: "model.XmlElementView.serialize.call", receiver: ref("element"), arguments: {} }
];
const edit = [
  ...select,
  {
    operation: "model.XmlElementView.set_attribute.call",
    receiver: ref("element"),
    arguments: { name: { namespaceURI: w, localName: "rsidR" }, value: "1234ABCD" }
  },
  { operation: "model.XmlElementView.attributes.get", receiver: ref("element"), arguments: {} }
];

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  return textFixture(paragraph("Leave this berth") + paragraph("Inspect this buoy"));
}

async function cli(input: Uint8Array, args: string[], signal = textContext.signal) {
  const volume = Volume.fromJSON({
    "/source.docx": Buffer.from(input),
    "/stdout": "",
    "/stderr": ""
  });
  const readFile = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const stdin = vi.fn(() => {
    throw new Error("Undeclared stdin access");
  });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map((arg) => new TextEncoder().encode(arg)),
    cwd: "/",
    signal,
    filesystem: { readFile },
    stdin: { [Symbol.asyncIterator]: stdin },
    stdout: {
      async write(bytes) {
        volume.appendFileSync("/stdout", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        volume.appendFileSync("/stderr", bytes);
      }
    }
  });
  expect(volume.readFileSync("/source.docx")).toEqual(Buffer.from(input));
  expect(stdin).not.toHaveBeenCalled();
  return { result, volume, readFile };
}

it("retains the public synchronous paragraph element and reads without creating parts or changing bytes", async () => {
  const input = await fixture(),
    doc = await Document(input, textContext);
  expect(Object.getOwnPropertyDescriptor(Paragraph.prototype, "element")?.get).toBeTypeOf(
    "function"
  );
  expectTypeOf<Paragraph["element"]>().toEqualTypeOf<XmlElementView>();
  const before = doc.store.revision + doc.store.package.revision;
  const element = doc.paragraphs[1]!.element;
  expect(element).toBeInstanceOf(XmlElementView);
  expect(element.tag).toEqual({ namespaceURI: w, localName: "p" });
  expect(new TextDecoder().decode(element.serialize())).toContain("Inspect this buoy");
  expect(element.children[0]!.tag).toEqual({ namespaceURI: w, localName: "r" });
  expect(doc.store.revision + doc.store.package.revision).toBe(before);
  const volume = Volume.fromJSON({ "/saved": "" });
  await doc.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  const saved = await readArchive(
    new Uint8Array(volume.readFileSync("/saved") as Buffer),
    textContext
  );
  const original = await readArchive(input, textContext);
  expect(saved.members.map((member) => [member.name, member.bytes])).toEqual(
    original.members.map((member) => [member.name, member.bytes])
  );
});

it("dispatches the actual paragraph getter with existing receiver, foreign-reference and stale checks", async () => {
  const doc = await Document(await fixture(), textContext),
    other = await Document(await fixture(), textContext);
  const action = structureModelBatchActions.get(getter);
  expect(action).toBeTypeOf("function");
  const spy = vi.spyOn(Paragraph.prototype, "element", "get");
  expect(action!(doc.paragraphs[1], {})).toBe(doc.paragraphs[1]!.element);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(() => action!({ element: doc.paragraphs[1]!.element }, {})).toThrow(DocxUsageError);
  expect(() => action!(doc.paragraphs[1]!.runs[0], {})).toThrow(DocxUsageError);
  expect(() => action!(new Paragraph(doc.store, other.paragraphs[1]!.ref), {})).toThrow(
    StaleHandleError
  );
  const selected = doc.paragraphs[1]!,
    element = selected.element;
  element.remove();
  expect(() => action!(selected, {})).toThrow(StaleHandleError);
  expect(() => element.tag).toThrow(StaleHandleError);
});

it("discovers the exact read-only getter and a closed XmlElementView result handle", () => {
  expectTypeOf<DocxBatchItemMap[typeof getter]["operation"]>().toEqualTypeOf<typeof getter>();
  expectTypeOf<DocxBatchArgumentMap[typeof getter]>().toEqualTypeOf<
    Readonly<Record<string, never>>
  >();
  expectTypeOf<DocxOperationArguments<typeof getter>>().toEqualTypeOf<
    Readonly<Record<string, never>>
  >();
  const root = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!
    .data as DocxSchemaData;
  const declaration = root.operations.find((item) => item.id === getter);
  expect(declaration).toMatchObject({
    id: getter,
    path: ["batch"],
    support: "read",
    featureIds: ["F04", "F05", "F07", "F08"]
  });
  expect(docxOperationSchemas[getter]).toMatchObject({
    mutates: false,
    receiver: "Paragraph",
    valueType: "XmlElementView",
    resultHandle: { allowed: true, type: "XmlElementView" },
    batchFields: {}
  });
  const detail = getDocxDiscovery({
    operation: "schema",
    inputs: [],
    options: { operation: getter }
  })!.data as DocxSchemaData;
  expect(detail.operations).toEqual([declaration]);
  expect(
    getDocxDiscovery({ operation: "help", inputs: [], options: { operation: getter } })!.human
  ).toContain(getter);
  const validate = new Ajv({ strict: false }).compile(declaration!.result);
  const value = { id: "handle3", type: "XmlElementView", owner: "document", revision: 0 };
  expect(validate({version: 1, operation: getter, ok: true, data: value, affected: 0, warnings: [], errors: [], locations: []})).toBe(true);
  for (const invalid of [
    { ...value, type: "Paragraph" },
    { ...value, owner: "batch" },
    { ...value, revision: 1 },
    { ...value, store: {} },
    null,
    "<w:p/>"
  ]) {
    expect(validate({version: 1, operation: getter, ok: true, data: invalid, affected: 0, warnings: [], errors: [], locations: []})).toBe(false);
  }
  const batch = (
    getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "batch" } })!
      .data as DocxSchemaData
  ).operations[0]!;
  const variants = batch.result.oneOf![0]!.properties!.data!.properties!.results!.items!;
  expect(
    variants && variants.oneOf!.find((item) => item.properties?.operation?.const === getter)
  ).toEqual(declaration!.result);
});

it.each([false, true])(
  "executes the SDK getter and XML serialization without mutation (Strict=%s)",
  async (strict) => {
    const input = await textFixture(
      paragraph("Leave this berth") + paragraph("Inspect this buoy"),
      {},
      strict
    );
    const original = input.slice();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Ambient network forbidden"));
    const applied = await applyStyleModelBatch(
      input,
      { version: 1, operations: read },
      textContext
    );
    expect(applied.affected).toBe(0);
    expect(applied.results[1]).toEqual({
      operation: getter,
      value: { id: "handle3", type: "XmlElementView", owner: "document", revision: 0 }
    });
    expect(applied.results[2]!.value).toEqual({
      namespaceURI: strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w,
      localName: "p"
    });
    const serialized = applied.results[3]!.value as { kind: string; base64: string };
    expect(serialized.kind).toBe("bytes");
    expect(Buffer.from(serialized.base64, "base64").toString()).toContain("Inspect this buoy");
    expect(input).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
  }
);

it("persists an explicitly requested XML attribute edit through SDK save and reload", async () => {
  const input = await fixture();
  const applied = await applyStyleModelBatch(input, { version: 1, operations: edit }, textContext);
  expect(applied.affected).toBe(1);
  expect(applied.results.at(-1)!.value).toEqual([
    { key: { namespaceURI: w, localName: "rsidR" }, value: "1234ABCD" }
  ]);
  const volume = Volume.fromJSON({ "/saved": "" });
  await applied.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  const doc = await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext);
  expect(doc.paragraphs.map((item) => item.text)).toEqual([
    "Leave this berth",
    "Inspect this buoy"
  ]);
  expect([...doc.paragraphs[0]!.element.attributes]).toEqual([]);
  expect([...doc.paragraphs[1]!.element.attributes]).toEqual([
    [{ namespaceURI: w, localName: "rsidR" }, "1234ABCD"]
  ]);
  const original = await readArchive(input, textContext),
    saved = await readArchive(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext);
  expect(
    saved.members
      .filter((item) => item.name !== "word/document.xml")
      .map((item) => [item.name, item.bytes])
  ).toEqual(
    original.members
      .filter((item) => item.name !== "word/document.xml")
      .map((item) => [item.name, item.bytes])
  );
});

it.each([
  { operation: getter, receiver: ref("paragraphs", 1), arguments: {} },
  { operation: "model.XmlElementView.tag.get", receiver: ref("element"), arguments: {} }
])("rejects detached paragraph or XML handles in $operation", async (operation) => {
  await expect(
    applyStyleModelBatch(
      await fixture(),
      {
        version: 1,
        operations: [
          ...select,
          {
            operation: "model.XmlElementView.remove.call",
            receiver: ref("element"),
            arguments: {}
          },
          operation
        ]
      },
      textContext
    )
  ).rejects.toThrow(StaleHandleError);
});

it("rejects foreign batch handles even when IDs and reported owners coincide", async () => {
  const input = await fixture();
  const previous = await applyStyleModelBatch(input, { version: 1, operations: read }, textContext);
  for (const operation of [
    { operation: getter, receiver: (previous.results[0]!.value as unknown[])[1], arguments: {} },
    {
      operation: "model.XmlElementView.tag.get",
      receiver: previous.results[1]!.value,
      arguments: {}
    }
  ])
    await expect(
      applyStyleModelBatch(input, { version: 1, operations: [...select, operation] }, textContext)
    ).rejects.toThrow(DocxUsageError);
});

it("retains required table-cell paragraph validation through the getter's XML view", async () => {
  const operations = [
    {
      operation: "model.document.Document.tables.get",
      receiver: ref("document"),
      arguments: {},
      resultHandle: "tables"
    },
    {
      operation: "model.table.Table.cell.call",
      receiver: ref("tables", 0),
      arguments: { rowIdx: 0, colIdx: 0 },
      resultHandle: "cell"
    },
    {
      operation: "model.table._Cell.paragraphs.get",
      receiver: ref("cell"),
      arguments: {},
      resultHandle: "paragraphs"
    },
    { operation: getter, receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element" },
    { operation: "model.XmlElementView.remove.call", receiver: ref("element"), arguments: {} }
  ];
  const input = await textFixture(table([paragraph("Keep the required cell paragraph")]));
  const run = await cli(input, [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--output",
    "-"
  ]);
  expect(run.result.exitCode).toBe(1);
  expect(run.volume.readFileSync("/stdout").length).toBe(0);
  expect(run.volume.readFileSync("/stderr", "utf8")).toContain("invalid-package");
});

it("executes actual CLI batch reads and operation help/schema with no undeclared I/O", async () => {
  const input = await fixture();
  const run = await cli(input, [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations: read }),
    "--json"
  ]);
  expect(run.result.exitCode).toBe(0);
  const envelope = JSON.parse(run.volume.readFileSync("/stdout", "utf8") as string);
  expect(envelope).toMatchObject({ ok: true, affected: 0, data: { publication: null } });
  expect(envelope.data.results).toEqual(
    (await applyStyleModelBatch(input, { version: 1, operations: read }, textContext)).operationResults
  );
  expect(run.readFile.mock.calls.map(([path]) => path)).toEqual(["/source.docx"]);
  expect(run.volume.readFileSync("/stderr").length).toBe(0);
  for (const command of ["help", "schema"]) {
    const discovery = await cli(input, [command, "batch", "--operation", getter, "--json"]);
    expect(discovery.result.exitCode).toBe(0);
    expect(discovery.readFile).not.toHaveBeenCalled();
    expect(discovery.volume.readFileSync("/stdout", "utf8")).toContain(getter);
  }
});

it("requires explicit CLI publication and reloads the authorized edit while dry-run remains pure", async () => {
  const input = await fixture(),
    args = [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations: edit })
    ];
  const denied = await cli(input, [...args, "--json"]);
  expect(denied.result.exitCode).toBe(2);
  expect(denied.readFile).not.toHaveBeenCalled();
  const dry = await cli(input, [...args, "--dry-run", "--json"]);
  expect(dry.result.exitCode).toBe(0);
  expect(JSON.parse(dry.volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({
    ok: true,
    affected: 1,
    data: { publication: {dryRun: true, output: null} }
  });
  const saved = await cli(input, [...args, "--output", "-"]);
  expect(saved.result.exitCode).toBe(0);
  const doc = await Document(
    new Uint8Array(saved.volume.readFileSync("/stdout") as Buffer),
    textContext
  );
  expect([...doc.paragraphs[1]!.element.attributes]).toEqual([
    [{ namespaceURI: w, localName: "rsidR" }, "1234ABCD"]
  ]);
  expect(doc.paragraphs.map((item) => item.text)).toEqual([
    "Leave this berth",
    "Inspect this buoy"
  ]);
  const readPublication = await cli(input, [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations: read }),
    "--output",
    "-",
    "--json"
  ]);
  expect(readPublication.result.exitCode).toBe(2);
});

it("rejects evaluation, dynamic property access and ambient paths before input acquisition", async () => {
  const input = await fixture();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Ambient network forbidden"));
  for (const operation of [
    { ...select[1], operation: "model.text.paragraph.Paragraph.constructor.call" },
    { ...select[1], arguments: { evaluate: "globalThis.fetch('https://invalid.example')" } },
    { ...select[1], arguments: { property: "store" } },
    { ...select[1], arguments: { path: "/private/secret" } },
    {
      operation: "model.XmlElementView.xpath.call",
      receiver: ref("element"),
      arguments: { expression: "//*" }
    }
  ]) {
    const operations = [...select, operation];
    expect(() => validateDocxBatch({ version: 1, operations })).toThrow(DocxUsageError);
    const run = await cli(input, [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      "--json"
    ]);
    expect(run.result.exitCode).toBe(2);
    expect(run.readFile).not.toHaveBeenCalled();
    expect(JSON.parse(run.volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({
      ok: false,
      affected: 0,
      data: null
    });
  }
  const evaluate = vi.fn(() => "ignored");
  expect(() =>
    validateDocxBatch({
      version: 1,
      operations: [
        {
          ...select[1],
          arguments: Object.defineProperty({}, "value", { enumerable: true, get: evaluate })
        }
      ]
    })
  ).toThrow(DocxUsageError);
  expect(evaluate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps repeated getter aliases on the selected paragraph after a preceding sibling is removed (Strict=%s)",
  async (strict) => {
    const namespaceURI = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const input = await textFixture(
      paragraph("Leave this berth") + paragraph("Inspect this buoy"),
      {},
      strict
    );
    const operations = [
      ...select,
      { ...select[1], resultHandle: "alias" },
      { operation: getter, receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "first" },
      { operation: "model.XmlElementView.remove.call", receiver: ref("first"), arguments: {} },
      {
        operation: "model.XmlElementView.set_attribute.call",
        receiver: ref("alias"),
        arguments: { name: { namespaceURI, localName: "rsidR" }, value: "0123ABCD" }
      },
      { operation: "model.XmlElementView.attributes.get", receiver: ref("element"), arguments: {} },
      {
        operation: "model.text.paragraph.Paragraph.text.get",
        receiver: ref("paragraphs", 1),
        arguments: {}
      },
      {
        operation: "model.XmlElementView.set_attribute.call",
        receiver: ref("element"),
        arguments: { name: { namespaceURI, localName: "rsidR" }, value: null }
      },
      { operation: "model.XmlElementView.attributes.get", receiver: ref("alias"), arguments: {} }
    ];
    const applied = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(applied.results[1]!.value).toEqual(applied.results[2]!.value);
    expect(applied.results[6]!.value).toEqual([
      { key: { namespaceURI, localName: "rsidR" }, value: "0123ABCD" }
    ]);
    expect(applied.results[7]!.value).toBe("Inspect this buoy");
    expect(applied.results[9]!.value).toEqual([]);
    const saved = await cli(input, [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      "--output",
      "-"
    ]);
    expect(saved.result.exitCode).toBe(0);
    const reopened = await Document(
      new Uint8Array(saved.volume.readFileSync("/stdout") as Buffer),
      textContext
    );
    expect(reopened.paragraphs.map((p) => p.text)).toEqual(["Inspect this buoy"]);
    expect(reopened.paragraphs[0]!.element.tag).toEqual({ namespaceURI, localName: "p" });
    expect([...reopened.paragraphs[0]!.element.attributes]).toEqual([]);
  }
);

it("retains child identity through insertion/removal via the actual getter and reloads the resulting text", async () => {
  const input = await fixture();
  const operations = [
    ...select,
    {
      operation: "model.XmlElementView.children.get",
      receiver: ref("element"),
      arguments: {},
      resultHandle: "children"
    },
    {
      operation: "model.XmlElementView.insert.call",
      receiver: ref("element"),
      arguments: {
        index: 0,
        node: {
          kind: "element",
          name: { namespaceURI: w, localName: "r" },
          children: [
            {
              kind: "element",
              name: { namespaceURI: w, localName: "t" },
              children: [{ kind: "text", text: "New marker" }]
            }
          ]
        }
      },
      resultHandle: "added"
    },
    {
      operation: "model.XmlElementView.serialize.call",
      receiver: ref("children", 0),
      arguments: {}
    },
    { operation: "model.XmlElementView.remove.call", receiver: ref("children", 0), arguments: {} },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("added"), arguments: {} }
  ];
  const applied = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
  const decode = (value: unknown) =>
    Buffer.from((value as { base64: string }).base64, "base64").toString();
  expect(decode(applied.results[4]!.value)).toContain("Inspect this buoy");
  expect(decode(applied.results[6]!.value)).toContain("New marker");
  expect(applied.affected).toBe(2);
  const saved = await cli(input, [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--output",
    "-"
  ]);
  expect(saved.result.exitCode).toBe(0);
  const reopened = await Document(
    new Uint8Array(saved.volume.readFileSync("/stdout") as Buffer),
    textContext
  );
  expect(reopened.paragraphs.map((p) => p.text)).toEqual(["Leave this berth", "New marker"]);
});

it("keeps the root getter live but invalidates descendants after whole-paragraph text replacement", async () => {
  const doc = await Document(await fixture(), textContext);
  const paragraph = doc.paragraphs[1]!,
    element = paragraph.element,
    child = element.children[0]!;
  paragraph.text = "Replacement buoy";
  expect(paragraph.element).toBe(element);
  expect(element.tag).toEqual({ namespaceURI: w, localName: "p" });
  expect(new TextDecoder().decode(element.serialize())).toContain("Replacement buoy");
  for (const operation of [() => child.tag, () => child.serialize(), () => child.remove()])
    expect(operation).toThrow(StaleHandleError);
  expect(doc.paragraphs[1]!.text).toBe("Replacement buoy");
});

it("publishes no bytes when a later stale descendant fails after a valid edit", async () => {
  const input = await fixture();
  const operations = [
    ...select,
    {
      operation: "model.XmlElementView.children.get",
      receiver: ref("element"),
      arguments: {},
      resultHandle: "children"
    },
    {
      operation: "model.text.paragraph.Paragraph.text.set",
      receiver: ref("paragraphs", 1),
      arguments: { value: "Replacement buoy" }
    },
    { operation: "model.XmlElementView.tag.get", receiver: ref("children", 0), arguments: {} }
  ];
  await expect(
    applyStyleModelBatch(input, { version: 1, operations }, textContext)
  ).rejects.toThrow(StaleHandleError);
  for (const output of [
    ["--output", "-"],
    ["--dry-run", "--json"]
  ]) {
    const run = await cli(input, [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      ...output
    ]);
    expect(run.result.exitCode).toBe(1);
    expect(run.volume.readFileSync("/stderr", "utf8")).toContain("stale-selection");
    if (output.includes("--json"))
      expect(JSON.parse(run.volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({
        ok: false,
        data: null,
        affected: 0,
        errors: [{ code: "stale-selection" }]
      });
    else expect(run.volume.readFileSync("/stdout").length).toBe(0);
  }
});

it("keeps returned attribute and byte snapshots independent of the live paragraph", async () => {
  const doc = await Document(await fixture(), textContext),
    element = doc.paragraphs[1]!.element;
  const before = element.serialize(),
    revision = doc.store.revision;
  (element.attributes as Map<unknown, unknown>).set(
    { namespaceURI: w, localName: "rsidR" },
    "1234ABCD"
  );
  element.serialize().fill(0);
  expect(Object.isFrozen(element.tag)).toBe(true);
  expect(Object.isFrozen(element.children)).toBe(true);
  expect(element.attributes.size).toBe(0);
  expect(element.serialize()).toEqual(before);
  expect(doc.store.revision).toBe(revision);
});

it.each([
  { resultHandle: "paragraphs" },
  { resultHandle: "paragraphs", index: -1 },
  { resultHandle: "paragraphs", index: 0.5 },
  { resultHandle: "paragraphs", index: "1" },
  { resultHandle: "paragraphs", index: null },
  { resultHandle: "paragraphs", index: 0, key: "one" },
  { resultHandle: "paragraphs", index: 1, owner: "document" },
  { resultHandle: "notDefined", index: 1 },
  { resultHandle: "document" }
])("rejects malformed getter receiver %j before acquiring the input", async (receiver) => {
  const input = await fixture();
  const operations = [select[0], { ...select[1], receiver }];
  await expect(
    applyStyleModelBatch(input, { version: 1, operations }, textContext)
  ).rejects.toThrow(DocxUsageError);
  const run = await cli(input, [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--json"
  ]);
  expect(run.result.exitCode).toBe(2);
  expect(run.readFile).not.toHaveBeenCalled();
  expect(JSON.parse(run.volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({
    ok: false,
    data: null,
    affected: 0
  });
});

it.each([0, 2])(
  "rejects selection beyond a %i-paragraph collection without publication",
  async (count) => {
    const input = await textFixture(
      Array.from({ length: count }, (_, i) => paragraph(`Berth ${i}`)).join("")
    );
    const operations = [select[0], { ...select[1], receiver: ref("paragraphs", count) }];
    await expect
      .soft(applyStyleModelBatch(input, { version: 1, operations }, textContext))
      .rejects.toThrow(BoundsError);
    const run = await cli(input, [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      "--json"
    ]);
    expect.soft(run.result.exitCode).toBe(1);
    expect(run.readFile.mock.calls.map(([path]) => path)).toEqual(["/source.docx"]);
    expect.soft(JSON.parse(run.volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({
      ok: false,
      data: null,
      affected: 0,
      errors: [{ code: "missing-selection" }]
    });
    expect(run.volume.readFileSync("/stderr", "utf8")).not.toContain("Berth");
  }
);

it.each(["document", "paragraphs", "", "bad-name", "__proto__"])(
  "rejects reserved, duplicate or malformed result binding %j",
  async (resultHandle) => {
    const operations = [select[0], { ...select[1], resultHandle }];
    const input = await fixture();
    await expect(
      applyStyleModelBatch(input, { version: 1, operations }, textContext)
    ).rejects.toThrow(DocxUsageError);
    const run = await cli(input, [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      "--json"
    ]);
    expect(run.result.exitCode).toBe(2);
    expect(run.readFile).not.toHaveBeenCalled();
  }
);

it("treats a constructor-named result binding as data and never as executable property access", async () => {
  const operations = [
    select[0],
    { ...select[1], resultHandle: "constructor" },
    { operation: "model.XmlElementView.tag.get", receiver: ref("constructor"), arguments: {} }
  ];
  const run = await cli(await fixture(), [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--json"
  ]);
  expect(run.result.exitCode).toBe(0);
  expect(
    JSON.parse(run.volume.readFileSync("/stdout", "utf8") as string).data.results.at(-1).data
  ).toEqual({ namespaceURI: w, localName: "p" });
});

it("rolls back forbidden cell removal and retains the original getter and child handles", async () => {
  const input = await textFixture(table([paragraph("Keep the terminal cell paragraph")]));
  const doc = await Document(input, textContext),
    p = doc.tables[0]!.cell(0, 0).paragraphs[0]!;
  const element = p.element,
    child = element.children[0]!,
    bytes = element.serialize();
  const revision = doc.store.revision;
  expect(() => element.remove()).toThrow();
  expect(p.element).toBe(element);
  expect(element.serialize()).toEqual(bytes);
  expect(child.tag).toEqual({ namespaceURI: w, localName: "r" });
  expect(doc.store.revision).toBe(revision);
});

it.each([
  { name: { namespaceURI: "http://www.w3.org/2000/xmlns/", localName: "w" }, value: "urn:changed" },
  { name: { namespaceURI: "urn:opaque", localName: "marker" }, value: "changed" },
  { name: { namespaceURI: w, localName: "rsidR" }, value: "\0" }
])("rejects unsupported XML attribute mutation %j and preserves live handles", async (args) => {
  const input = await fixture(),
    doc = await Document(input, textContext),
    p = doc.paragraphs[1]!;
  const bytes = p.element.serialize(),
    child = p.element.children[0]!,
    revision = doc.store.revision;
  expect(() => p.element.set_attribute(args.name, args.value)).toThrow();
  expect(p.element.serialize()).toEqual(bytes);
  expect(child.tag.localName).toBe("r");
  expect(doc.store.revision).toBe(revision);
  const operations = [
    ...select,
    {
      operation: "model.XmlElementView.set_attribute.call",
      receiver: ref("element"),
      arguments: args
    }
  ];
  await expect(
    applyStyleModelBatch(input, { version: 1, operations }, textContext)
  ).rejects.toThrow();
  const run = await cli(input, [
    "batch",
    "/source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--output",
    "-"
  ]);
  expect(run.result.exitCode).toBe(1);
  expect(run.volume.readFileSync("/stdout").length).toBe(0);
});

it("honors cancellation of an acquired paragraph view and of CLI admission", async () => {
  const input = await fixture(),
    controller = new AbortController();
  const doc = await Document(input, { ...textContext, signal: controller.signal });
  const p = doc.paragraphs[1]!,
    element = p.element;
  controller.abort();
  for (const operation of [
    () => p.element,
    () => element.tag,
    () => element.serialize(),
    () => element.remove()
  ])
    expect(operation).toThrow(CancellationError);
  await expect(
    applyStyleModelBatch(
      input,
      { version: 1, operations: read },
      { ...textContext, signal: controller.signal }
    )
  ).rejects.toThrow(CancellationError);
  const run = await cli(
    input,
    [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations: read }),
      "--json"
    ],
    controller.signal
  );
  expect(run.result.exitCode).toBe(130);
  expect(run.readFile).not.toHaveBeenCalled();
});

it("shares the document work budget with an acquired getter and bounds XML serialization", async () => {
  const input = await fixture();
  const budget = new DocumentBudget({ work: 1_000_000 }, textContext.signal);
  const doc = await Document(input, { ...textContext, budget }),
    p = doc.paragraphs[1]!,
    element = p.element;
  const before = budget.usage.work;
  void element.children;
  expect(budget.usage.work).toBeGreaterThan(before);
  budget.charge("work", budget.limits.work - budget.usage.work);
  expect(() => element.children[0]!.tag).toThrow(ResourceLimitError);
  const limited = await Document(input, {
    ...textContext,
    budget: new DocumentBudget({ serializedOutput: 1 })
  });
  expect(() => limited.paragraphs[1]!.element.serialize()).toThrow(ResourceLimitError);
});

it.each(["batchOperations=3", "serializedOutput=1"])(
  "enforces CLI getter batch limit %s without partial output",
  async (limit) => {
    const run = await cli(await fixture(), [
      "batch",
      "/source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations: read }),
      "--limit",
      limit
    ]);
    expect(run.result.exitCode).toBe(4);
    expect(run.volume.readFileSync("/stdout").length).toBe(0);
    expect(run.volume.readFileSync("/stderr", "utf8")).toContain("limit");
  }
);
