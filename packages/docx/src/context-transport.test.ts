import { expect, expectTypeOf, it, vi } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { docxOperationSchemas, validateDocxValue } from "./operation-schema.js";
import { docxValueSchema } from "./operation-json-schema.js";
import { Ajv } from "ajv";

const packageOpen = "model.package.Package.open.call";
const binary = (bytes: Uint8Array) => ({
  kind: "bytes",
  base64: Buffer.from(bytes).toString("base64")
});
const transport = (value: unknown, host: unknown) =>
  (
    api as unknown as {
      resolveDocumentModelContext(value: unknown, host: unknown): Promise<api.DocumentModelContext>;
    }
  ).resolveDocumentModelContext(value, host);

it("resolves declarative context tokens only through supplied trusted adapters", async () => {
  const bytes = await textFixture(paragraph("Delta template"));
  const volume = Volume.fromJSON({ "/template.docx": Buffer.from(bytes) });
  const measure = vi.fn(() => 17),
    open = vi.fn(async function* (path: string) {
      yield new Uint8Array(volume.readFileSync(path) as Buffer);
    });
  const host = {
    ...textContext,
    binaryResolver: { capability: "delta", open },
    fontResolver: { capability: "metrics", fonts: { measure } }
  };
  const selected = await transport(
    {
      vfs: "delta",
      fonts: "metrics",
      template: { kind: "vfs", path: "/template.docx", capability: "delta" },
      author: "Delta",
      timestamp: "2026-09-15T02:03:04Z",
      limits: { tableRows: 2 }
    },
    host
  );
  expect(selected.fonts!.measure("ebb", "Supplied", 11)).toBe(17);
  expect(measure).toHaveBeenCalledWith("ebb", "Supplied", 11);
  expect((await api.Document(null, selected)).paragraphs[0]!.text).toBe("Delta template");
  expect(selected.author).toBe("Delta");
  expect(selected.timestamp!.toISOString()).toBe("2026-09-15T02:03:04.000Z");
  expect(open).toHaveBeenCalledOnce();
  for (const value of [
    { vfs: "foreign" },
    { fonts: "foreign" },
    { fonts: {} },
    { vfs: {} },
    { signal: {} },
    { metrics: "metrics" }
  ])
    await expect(transport(value, host)).rejects.toMatchObject({ code: "usage" });
  await expect(transport({ fonts: "metrics" }, textContext)).rejects.toMatchObject({
    code: "usage"
  });
});

it("admits package-open context through actual SDK and CLI batch execution", async () => {
  const input = await textFixture(paragraph("Outer")),
    other = await textFixture(paragraph("Acquired"));
  const operations = [
    {
      operation: packageOpen,
      arguments: {
        pkgFile: { path: "/other.docx", capability: "command" },
        context: {
          vfs: "command",
          fonts: "metrics",
          timestamp: "2026-09-15T00:00:00Z",
          author: "Explicit"
        }
      },
      resultHandle: "opened"
    },
    {
      operation: "model.package.Package.main_document_part.get",
      receiver: { resultHandle: "opened" },
      arguments: {},
      resultHandle: "part"
    },
    {
      operation: "model.opc.part.XmlPart.blob.get",
      receiver: { resultHandle: "part" },
      arguments: {}
    },
    {
      operation: "model.package.Package.core_properties.get",
      receiver: { resultHandle: "opened" },
      arguments: {},
      resultHandle: "properties"
    },
    {
      operation: "model.opc.coreprops.CoreProperties.last_modified_by.get",
      receiver: { resultHandle: "properties" },
      arguments: {}
    },
    {
      operation: "model.opc.coreprops.CoreProperties.modified.get",
      receiver: { resultHandle: "properties" },
      arguments: {}
    }
  ];
  const volume = Volume.fromJSON({
    "/input.docx": Buffer.from(input),
    "/other.docx": Buffer.from(other),
    "/stdout": "",
    "/stderr": ""
  });
  const readFile = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const readStream = vi.fn(async function* (path: string) {
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  });
  const fontResolver = { capability: "metrics", fonts: { measure: vi.fn(() => 17) } };
  const sdk = await api.applyStyleModelBatch(
    input,
    { version: 1, operations },
    { ...textContext, binaryResolver: { capability: "command", open: readStream }, fontResolver }
  );
  expect(
    Buffer.from((sdk.results[2]!.value as { base64: string }).base64, "base64").toString()
  ).toContain("Acquired");
  expect(sdk.results[4]!.value).toBe("Explicit");
  expect(sdk.results[5]!.value).toBe("2026-09-15T00:00:00.000Z");
  const result = await api
    .createDocxInspectionCommandEngine({ limits: textContext.limits, fontResolver })
    .execute({
      args: [
        "batch",
        "/input.docx",
        "--ops-json",
        JSON.stringify({ version: 1, operations }),
        "--dry-run",
        "--json"
      ].map((value) => new TextEncoder().encode(value)),
      cwd: "/",
      signal: textContext.signal,
      filesystem: { readFile, readStream },
      stdin: {
        [Symbol.asyncIterator]() {
          throw new Error("Undeclared stdin");
        }
      },
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
  expect(result.exitCode, String(volume.readFileSync("/stderr", "utf8"))).toBe(0);
  expect(JSON.parse(volume.readFileSync("/stdout", "utf8") as string).data.results).toEqual(
    sdk.operationResults
  );
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  expect(volume.readFileSync("/other.docx")).toEqual(Buffer.from(other));
});

it("supports the full declared image context instead of rejecting its identity and font fields", async () => {
  const input = await textFixture(paragraph("Outer"));
  const result = await api.applyStyleModelBatch(
    input,
    {
      version: 1,
      operations: [
        {
          operation: "model.image.image.Image.from_blob.call",
          arguments: {
            blob: binary(rasterPng()),
            context: {
              fonts: "metrics",
              timestamp: "2026-09-15T00:00:00Z",
              author: "Explicit",
              limits: { embeddedMediaBytes: 100 }
            }
          },
          resultHandle: "image"
        },
        {
          operation: "model.image.image.Image.px_width.get",
          receiver: { resultHandle: "image" },
          arguments: {}
        }
      ]
    },
    {
      ...textContext,
      fontResolver: { capability: "metrics", fonts: { measure: () => 17 } }
    } as never
  );
  expect(result.results[1]!.value).toBe(1);
});

it("snapshots transport metadata, limits, template descriptor and adapters before template awaits", async () => {
  const bytes = await textFixture(paragraph("Captured channel"));
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const value = {
    template: { kind: "vfs" as const, path: "/template", capability: "owned" },
    fonts: "metrics",
    author: "Before",
    timestamp: "2026-09-15T00:00:00Z",
    limits: { tableRows: 2 }
  };
  const measure = vi.fn(() => 7);
  const host = {
    ...textContext,
    fontResolver: { capability: "metrics", fonts: { measure } },
    binaryResolver: {
      capability: "owned",
      async *open(path: string) {
        expect(path).toBe("/template");
        entered();
        await waiting;
        yield bytes;
      }
    }
  };
  const pending = api.resolveDocumentModelContext(value, host);
  await entry;
  value.author = "After";
  value.timestamp = "2000-01-01T00:00:00Z";
  value.limits.tableRows = 99;
  value.template.path = "/other";
  host.fontResolver.fonts.measure = vi.fn(() => 99);
  host.fontResolver.capability = "changed";
  release();
  const context = await pending;
  expect(context.author).toBe("Before");
  expect(context.timestamp!.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  expect(context.fonts!.measure("ebb", "Admitted", 12)).toBe(7);
  const model = await api.Document(null, context);
  expect(model.paragraphs[0]!.text).toBe("Captured channel");
  expect(() => model.add_table(3, 1, api.Inches(2))).toThrow(
    expect.objectContaining({ code: "limit-exceeded" })
  );
});

it("uses canonical base64 templates and rejects transport accessors, bytes overflow and cancellation", async () => {
  const bytes = await textFixture(paragraph("Base64 template"));
  const context = await api.resolveDocumentModelContext(
    { template: binary(bytes) as api.DocxBinaryInput },
    textContext
  );
  expect((await api.Document(null, context)).paragraphs[0]!.text).toBe("Base64 template");
  const getter = vi.fn(() => "owned");
  await expect(
    transport(Object.defineProperty({}, "vfs", { get: getter }), textContext)
  ).rejects.toMatchObject({ code: "usage" });
  await expect(
    transport(
      { template: Object.defineProperty({ kind: "bytes" }, "base64", { get: getter }) },
      textContext
    )
  ).rejects.toMatchObject({ code: "usage" });
  expect(getter).not.toHaveBeenCalled();
  await expect(
    api.resolveDocumentModelContext(
      {
        template: binary(bytes) as api.DocxBinaryInput,
        limits: { compressedInput: bytes.length - 1 }
      },
      textContext
    )
  ).rejects.toMatchObject({ code: "limit-exceeded" });
  const controller = new AbortController();
  controller.abort();
  await expect(
    api.resolveDocumentModelContext(
      { template: binary(bytes) as api.DocxBinaryInput },
      { ...textContext, signal: controller.signal }
    )
  ).rejects.toMatchObject({ code: "cancelled" });
});

it("owns native SDK package bytes before batch admission yields", async () => {
  const input = await textFixture(paragraph("Outer")),
    bytes = await textFixture(paragraph("Owned SDK bytes"));
  const pending = api.applyStyleModelBatch(
    input,
    {
      version: 1,
      operations: [
        { operation: packageOpen, arguments: { pkgFile: bytes }, resultHandle: "opened" },
        {
          operation: "model.package.Package.main_document_part.get",
          receiver: { resultHandle: "opened" },
          arguments: {},
          resultHandle: "part"
        },
        {
          operation: "model.opc.part.XmlPart.blob.get",
          receiver: { resultHandle: "part" },
          arguments: {}
        }
      ]
    },
    textContext
  );
  bytes.fill(0);
  expect(
    Buffer.from(
      ((await pending).results[2]!.value as { base64: string }).base64,
      "base64"
    ).toString()
  ).toContain("Owned SDK bytes");
});

it("maps model template selection to SDK creation and the direct CLI template flag", async () => {
  const template = await textFixture(paragraph("Template delta"));
  const volume = Volume.fromJSON({
    "/template.docx": Buffer.from(template),
    "/model": "",
    "/sdk": "",
    "/cli": "",
    "/stderr": ""
  });
  const model = await api.Document(null, { ...textContext, template });
  await model.save({
    async write(bytes) {
      volume.appendFileSync("/model", bytes);
    }
  });
  await api.createDocument(
    { template },
    { output: "-" },
    {
      ...textContext,
      encoding: { order: "input", compression: "store" },
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/sdk", bytes);
        }
      }
    }
  );
  const result = await api
    .createDocxInspectionCommandEngine({ limits: textContext.limits })
    .execute({
      args: ["create", "--template", "/template.docx", "--output", "-"].map((value) =>
        new TextEncoder().encode(value)
      ),
      cwd: "/",
      signal: textContext.signal,
      filesystem: {
        async readFile(path) {
          return new Uint8Array(volume.readFileSync(path) as Buffer);
        }
      },
      stdin: {
        [Symbol.asyncIterator]() {
          throw new Error("Undeclared stdin");
        }
      },
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/cli", bytes);
        }
      },
      stderr: {
        async write(bytes) {
          volume.appendFileSync("/stderr", bytes);
        }
      }
    });
  expect(result.exitCode, String(volume.readFileSync("/stderr", "utf8"))).toBe(0);
  for (const path of ["/model", "/sdk", "/cli"])
    expect(
      (await api.Document(new Uint8Array(volume.readFileSync(path) as Buffer), textContext))
        .paragraphs[0]!.text
    ).toBe("Template delta");
  expect(volume.readFileSync("/template.docx")).toEqual(Buffer.from(template));
});

it("keeps runtime, JSON schema and SDK context declarations declarative and resource-specific", () => {
  const schema = new Ajv({ strict: false }).compile(docxValueSchema("DocumentContext"));
  const context: api.DocxTransportContext = {
    fonts: "metrics",
    vfs: "owned",
    template: { kind: "bytes", base64: "AA==" },
    author: "Explicit",
    timestamp: "2026-09-15T00:00:00Z",
    limits: { work: 2 }
  };
  expect(schema(context)).toBe(true);
  expect(validateDocxValue("DocumentContext", context)).toBe(true);
  for (const invalid of [
    { ...context, fonts: {} },
    { ...context, vfs: {} },
    { metrics: "metrics" },
    { signal: {} }
  ]) {
    expect(schema(invalid)).toBe(false);
    expect(validateDocxValue("DocumentContext", invalid)).toBe(false);
  }
  const imageContext =
    docxOperationSchemas["model.image.image.Image.from_file.call"]!.fields.context!.wireType!;
  expect(validateDocxValue(imageContext, { fonts: "metrics", author: "Explicit" })).toBe(true);
  expect(validateDocxValue(imageContext, { template: context.template })).toBe(false);
  expect(docxOperationSchemas[packageOpen]!.resultHandle!.type).toBe("PackageView");
  expectTypeOf<api.DocxVfsPath["capability"]>().toEqualTypeOf<api.DocumentVfsCapability | string>();
  expectTypeOf<
    api.DocxOperationArguments<"model.image.image.Image.from_file.call">["context"]
  >().toEqualTypeOf<Omit<api.DocxTransportContext, "template"> | undefined>();
});

it("rejects wrong or unavailable font tokens and per-item template conflicts before package acquisition", async () => {
  const input = await textFixture(paragraph("Outer")),
    open = vi.fn(async function* () {
      yield input;
    });
  for (const context of [
    { fonts: "absent" },
    { vfs: "foreign" },
    { template: binary(input) },
    { template: { kind: "vfs", path: "/template", capability: "owned" } }
  ]) {
    await expect(
      api.applyStyleModelBatch(
        input,
        {
          version: 1,
          operations: [
            {
              operation: packageOpen,
              arguments: { pkgFile: { path: "/input", capability: "owned" }, context }
            }
          ]
        },
        { ...textContext, binaryResolver: { capability: "owned", open } }
      )
    ).rejects.toMatchObject({ code: "usage" });
  }
  expect(open).not.toHaveBeenCalled();
});

it("returns the selected VFS token as an admitted object capability for public model input", async () => {
  const bytes = await textFixture(paragraph("Resolved object"));
  const volume = Volume.fromJSON({ "/source.docx": Buffer.from(bytes) });
  const context = await api.resolveDocumentModelContext(
    { vfs: "owned" },
    {
      ...textContext,
      binaryResolver: {
        capability: "owned",
        async *open(path) {
          yield new Uint8Array(volume.readFileSync(path) as Buffer);
        }
      }
    }
  );
  expect(context.vfs).toBeDefined();
  expect(
    (await api.Document({ path: "/source.docx", capability: context.vfs! }, context)).paragraphs[0]!
      .text
  ).toBe("Resolved object");
});
