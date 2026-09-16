import { beforeAll, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  Drawing,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  type DocxCapabilitiesData,
  type XmlElementView
} from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const context = {
  ...textContext,
  timestamp: new Date("2026-09-16T00:00:00Z"),
  author: "Harbour recorder"
};
const handle = (resultHandle: string, index?: number) =>
  index === undefined ? { resultHandle } : { resultHandle, index };
type Step = {
  operation: string;
  receiver?: ReturnType<typeof handle>;
  arguments: Record<string, unknown>;
  resultHandle?: string;
};
const get = (
  operation: string,
  receiver: ReturnType<typeof handle>,
  resultHandle: string,
  args: Record<string, unknown> = {}
): Step => ({ operation, receiver, arguments: args, resultHandle });
const setup: Step[] = [
  get("model.document.Document.paragraphs.get", handle("document"), "paragraphs"),
  get("model.text.paragraph.Paragraph.runs.get", handle("paragraphs", 0), "runs"),
  get("model.text.paragraph.Paragraph.hyperlinks.get", handle("paragraphs", 1), "links"),
  get("model.text.run.Run.iter_inner_content.call", handle("runs", 1), "drawingContent"),
  get("model.document.Document.tables.get", handle("document"), "tables"),
  get("model.table.Table.cell.call", handle("tables", 0), "cell", { rowIdx: 0, colIdx: 0 }),
  get("model.table.Table.rows.get", handle("tables", 0), "rows"),
  get("model.table._Rows.__getitem__.get", handle("rows"), "row", { index: 0 }),
  get("model.table.Table.columns.get", handle("tables", 0), "columns"),
  get("model.table._Columns.__getitem__.get", handle("columns"), "column", { index: 0 }),
  get("model.document.Document.sections.get", handle("document"), "sections"),
  get("model.section.Sections.__getitem__.get", handle("sections"), "section", { index: 0 }),
  get("model.section.Section.header.get", handle("section"), "header"),
  get("model.section.Section.footer.get", handle("section"), "footer"),
  get("model.document.Document.comments.get", handle("document"), "comments"),
  get("model.comments.Comments.get.call", handle("comments"), "comment", { commentId: 0 }),
  get("model.document.Document.inline_shapes.get", handle("document"), "shapes"),
  get("model.shape.InlineShapes.__getitem__.get", handle("shapes"), "shape", { index: 0 }),
  get("model.document.Document.core_properties.get", handle("document"), "properties"),
  get("model.text.paragraph.Paragraph.element.get", handle("paragraphs", 0), "xml")
];
let input: Uint8Array;
let document: Awaited<ReturnType<typeof Document>>;
beforeAll(async () => {
  const model = await Document(
    await textFixture(
      paragraph("Harbour log") +
        '<w:p><w:hyperlink w:anchor="harbour" w:history="1"><w:r><w:t>Stored link</w:t></w:r></w:hyperlink></w:p><w:sectPr/>'
    ),
    context
  );
  await model.paragraphs[0]!.add_run().add_picture(rasterPng(2, 3));
  model.add_table(1, 2).cell(0, 0).text = "Tidal sample";
  model.add_heading("Daily readings", 1);
  model.sections.at(0).header.paragraphs[0]!.text = "Harbour header";
  model.sections.at(0).footer.paragraphs[0]!.text = "Harbour footer";
  model.comments.add_comment("Original observation");
  model.core_properties.title = "Harbour observations";
  const volume = Volume.fromJSON({ "/source": "" });
  await model.save({
    async write(bytes) {
      volume.appendFileSync("/source", bytes);
    }
  });
  input = new Uint8Array(volume.readFileSync("/source") as Buffer);
  document = await Document(input, context);
  expect(document.tables[0]!.cell(0, 0).text).toBe("Tidal sample");
  expect(document.paragraphs.at(-1)!.text).toBe("Daily readings");
  expect(document.comments.get(0)!.text).toBe("Original observation");
});

async function execute(args: string[]) {
  const volume = Volume.fromJSON({
    "/source.docx": Buffer.from(input),
    "/stdout": "",
    "/stderr": ""
  });
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: (args[0] === "batch" ? [...args, "--dry-run"] : args).map((word) =>
      new TextEncoder().encode(word)
    ),
    cwd: "/",
    signal: context.signal,
    filesystem: {
      async readFile(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      }
    },
    stdin: { async *[Symbol.asyncIterator]() {} },
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
  expect(result.exitCode, volume.readFileSync("/stderr", "utf8") as string).toBe(0);
  expect(volume.readFileSync("/source.docx")).toEqual(Buffer.from(input));
  return JSON.parse(volume.readFileSync("/stdout", "utf8") as string).data;
}

const elements: readonly [string, ReturnType<typeof handle>, () => XmlElementView, string][] = [
  ["model.comments.Comment", handle("comment"), () => document.comments.get(0)!.element, "comment"],
  [
    "model.text.hyperlink.Hyperlink",
    handle("links", 0),
    () => document.paragraphs[1]!.hyperlinks[0]!.element,
    "hyperlink"
  ],
  [
    "model.drawing.Drawing",
    handle("drawingContent", 0),
    () => ([...document.paragraphs[0]!.runs[1]!.iter_inner_content()][0] as Drawing).element,
    "drawing"
  ],
  [
    "model.shape.InlineShape",
    handle("shape"),
    () => document.inline_shapes.at(0).element,
    "inline"
  ],
  ["model.section.Section", handle("section"), () => document.sections.at(0).element, "sectPr"],
  ["model.section._Header", handle("header"), () => document.sections.at(0).header.element, "hdr"],
  ["model.section._Footer", handle("footer"), () => document.sections.at(0).footer.element, "ftr"],
  ["model.table.Table", handle("tables", 0), () => document.tables[0]!.element, "tbl"],
  ["model.table._Cell", handle("cell"), () => document.tables[0]!.cell(0, 0).element, "tc"],
  ["model.table._Row", handle("row"), () => document.tables[0]!.rows.at(0).element, "tr"],
  [
    "model.table._Column",
    handle("column"),
    () => document.tables[0]!.columns.at(0).element,
    "gridCol"
  ],
  [
    "model.opc.coreprops.CoreProperties",
    handle("properties"),
    () => document.core_properties.element,
    "coreProperties"
  ]
];
it.each(elements)(
  "exposes the current public %s XML getter through SDK and real CLI",
  async (prefix, receiver, sdk, expectedTag) => {
    expect(sdk().localName).toBe(expectedTag);
    const operations = [
      ...setup,
      get(`${prefix}.element.get`, receiver, "selectedXml"),
      get("model.XmlElementView.serialize.call", handle("selectedXml"), "serialized")
    ];
    const batch = { version: 1, operations };
    const cli = await execute([
      "batch",
      "source.docx",
      "--ops-json",
      JSON.stringify(batch),
      "--json"
    ]);
    const expected = { kind: "bytes", base64: Buffer.from(sdk().serialize()).toString("base64") };
    expect(cli.results.at(-1).value).toEqual(expected);
    expect((await applyStyleModelBatch(input, batch, context)).results.at(-1)!.value).toEqual(
      expected
    );
  }
);

it.each([
  ["model.text.paragraph.Paragraph", handle("paragraphs", 0), () => document.paragraphs[0]!],
  ["model.text.run.Run", handle("runs", 0), () => document.paragraphs[0]!.runs[0]!],
  ["model.comments.Comment", handle("comment"), () => document.comments.get(0)!],
  ["model.section.Section", handle("section"), () => document.sections.at(0)]
] as const)(
  "exposes %s owner equality without permitting arbitrary invocation",
  async (prefix, receiver, sdk) => {
    expect(sdk().equals(sdk())).toBe(true);
    expect(sdk().equals({})).toBe(false);
    const operations = [
      ...setup,
      get(`${prefix}.__eq__.call`, receiver, "same", { other: receiver }),
      get(`${prefix}.__eq__.call`, receiver, "different", { other: {} })
    ];
    const cli = await execute([
      "batch",
      "source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      "--json"
    ]);
    expect(cli.results.slice(-2).map((row: { value: unknown }) => row.value)).toEqual([
      true,
      false
    ]);
  }
);

it("rejects undeclared calls, extra arguments and forged receiver fields before document I/O", async () => {
  let reads = 0;
  const engine = createDocxInspectionCommandEngine({ limits: context.limits });
  for (const operation of [
    {
      operation: "model.comments.Comment.constructor.call",
      receiver: handle("document"),
      arguments: {}
    },
    {
      operation: "model.comments.Comment.element.get",
      receiver: handle("document"),
      arguments: { arbitrary: "call" }
    },
    {
      operation: "model.comments.Comment.element.get",
      receiver: { resultHandle: "document", arbitrary: "call" },
      arguments: {}
    }
  ]) {
    const result = await engine.execute({
      args: [
        "batch",
        "source.docx",
        "--ops-json",
        JSON.stringify({ version: 1, operations: [operation] })
      ].map((word) => new TextEncoder().encode(word)),
      cwd: "/",
      signal: context.signal,
      filesystem: {
        async readFile() {
          reads++;
          throw new Error("Input must not be acquired.");
        }
      },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write() {} },
      stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(2);
  }
  expect(reads).toBe(0);
});

it("exposes returned metadata, XML name components and cell ownership", async () => {
  const operations = [
    ...setup,
    get("model.text.hyperlink.Hyperlink.history.get", handle("links", 0), "history"),
    get("model.XmlElementView.localName.get", handle("xml"), "name"),
    get("model.XmlElementView.namespace.get", handle("xml"), "namespace"),
    get("model.table._Cell.table.get", handle("cell"), "ownerTable"),
    get("model.table.Table.cell.call", handle("ownerTable"), "ownedCell", { rowIdx: 0, colIdx: 0 }),
    get("model.table._Cell.text.get", handle("ownedCell"), "cellText"),
    get("model.shape.InlineShape.part.get", handle("shape"), "shapePart"),
    get("model.opc.part.XmlPart.content_type.get", handle("shapePart"), "shapeType"),
    get("model.opc.coreprops.CoreProperties.part.get", handle("properties"), "propertyPart"),
    get("model.opc.part.XmlPart.content_type.get", handle("propertyPart"), "propertyType")
  ];
  const cli = await execute([
    "batch",
    "source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--json"
  ]);
  const values = new Map(
    cli.results.map((row: { operation: string; value: unknown }) => [row.operation, row.value])
  );
  expect(values.get("model.text.hyperlink.Hyperlink.history.get")).toBe(
    document.paragraphs[1]!.hyperlinks[0]!.history
  );
  expect(values.get("model.text.hyperlink.Hyperlink.history.get")).toBe(true);
  expect(values.get("model.XmlElementView.localName.get")).toBe("p");
  expect(values.get("model.XmlElementView.namespace.get")).toBe(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  );
  expect(values.get("model.table._Cell.text.get")).toBe("Tidal sample");
  expect(cli.results.at(-3).value).toBe(document.inline_shapes.at(0).part.content_type);
  expect(cli.results.at(-1).value).toBe(document.core_properties.part.content_type);
});

it("describes the executed live model families without stale utility-era pending claims", async () => {
  const capabilities = (await execute(["capabilities", "--json"])) as DocxCapabilitiesData;
  const stale = [
    "live model owners remain pending",
    "live hyperlink model remain pending",
    "live table owners remain pending",
    "Live document model and general image/table editing remain pending",
    "Model methods remain pending",
    "document content model operations remain pending",
    "live image-part/drawing/collection models remain pending"
  ];
  for (const phrase of stale)
    expect(
      capabilities.features
        .flatMap((feature) => feature.subsets)
        .filter((subset) => subset.reason.includes(phrase))
    ).toEqual([]);
});
