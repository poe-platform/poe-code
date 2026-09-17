import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Ajv } from "ajv";
import {
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  Document,
  editDocumentStyles,
  inspectDocumentStyles,
  type DocxSchemaData
} from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

async function execute(input: Uint8Array, words: string[]) {
  const volume = Volume.fromJSON({
    "/work/source.docx": Buffer.from(input),
    "/stdout": "",
    "/stderr": ""
  });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: words.map((word) => new TextEncoder().encode(word)),
    cwd: "/work",
    signal: textContext.signal,
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
  expect(volume.readFileSync("/work/source.docx")).toEqual(Buffer.from(input));
  return {
    ...result,
    bytes: new Uint8Array(volume.readFileSync("/stdout") as Buffer),
    stdout: volume.readFileSync("/stdout", "utf8") as string,
    stderr: volume.readFileSync("/stderr", "utf8") as string
  };
}

it("executes all direct defaults and latent paths with SDK-equivalent edits and schema-valid reads", async () => {
  let input = await textFixture(paragraph("Original harbour report"));
  const edits = [
    { operation: "styles.defaults.set", flags: ["--bold", "false"], options: { bold: false } },
    {
      operation: "styles.latent.defaults.set",
      flags: ["--default-to-hidden", "true", "--default-priority", "0"],
      options: { defaultToHidden: true, defaultPriority: 0 }
    },
    {
      operation: "styles.latent.add",
      flags: ["--name", "Tide Note", "--hidden", "false", "--priority", "0"],
      options: { name: "Tide Note", hidden: false, priority: 0 }
    },
    {
      operation: "styles.latent.set",
      flags: ["--name", "Tide Note", "--locked", "true"],
      options: { name: "Tide Note", locked: true }
    }
  ] as const;
  for (const edit of edits) {
    const cli = await execute(input, [
      ...edit.operation.split("."),
      "source.docx",
      ...edit.flags,
      "--output",
      "-"
    ]);
    expect(cli.exitCode, cli.stderr).toBe(0);
    const volume = Volume.fromJSON({ "/sdk.docx": "" });
    await editDocumentStyles(
      input,
      { operation: edit.operation, ...edit.options, output: "-" } as Parameters<
        typeof editDocumentStyles
      >[1],
      {
        ...textContext,
        encoding: { order: "input", compression: "store" },
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/sdk.docx", bytes);
          }
        }
      }
    );
    expect(cli.bytes, edit.operation).toEqual(
      new Uint8Array(volume.readFileSync("/sdk.docx") as Buffer)
    );
    input = cli.bytes;
  }
  const doc = await Document(input, textContext);
  expect(doc.styles.latent_styles.at("Tide Note")).toMatchObject({
    hidden: false,
    locked: true,
    priority: 0
  });
  expect(doc.styles.latent_styles.default_to_hidden).toBe(true);
  expect(doc.styles.latent_styles.default_priority).toBe(0);
  expect((await inspectDocumentStyles(input, {}, textContext)).defaults.run.bold).toBe(false);
  for (const [operation, flags] of [
    ["styles.defaults.get", []],
    ["styles.latent.list", []],
    ["styles.latent.get", ["--name", "Tide Note"]],
    ["styles.latent.defaults.get", []]
  ] as const) {
    const cli = await execute(input, [...operation.split("."), "source.docx", ...flags, "--json"]);
    expect(cli.exitCode, cli.stderr).toBe(0);
    const discovery = await execute(input, ["schema", ...operation.split("."), "--json"]);
    expect(discovery.exitCode, discovery.stderr).toBe(0);
    const schema = (JSON.parse(discovery.stdout).data as DocxSchemaData).operations[0]!.result;
    const validate = new Ajv({ strict: false, validateSchema: false }).compile(schema);
    expect(validate(JSON.parse(cli.stdout)), JSON.stringify(validate.errors)).toBe(true);
  }
  const removed = await execute(input, [
    "styles",
    "latent",
    "remove",
    "source.docx",
    "--name",
    "Tide Note",
    "--output",
    "-"
  ]);
  expect(removed.exitCode, removed.stderr).toBe(0);
  expect((await Document(removed.bytes, textContext)).styles.latent_styles.length).toBe(0);
});

it("describes verified live paragraph and core-property model routes without utility-era pending claims", async () => {
  const input = await textFixture(paragraph("Original harbour report"));
  const operations = [
    {
      operation: "model.document.Document.paragraphs.get",
      receiver: { resultHandle: "document" },
      arguments: {},
      resultHandle: "paragraphs"
    },
    {
      operation: "model.text.paragraph.Paragraph.text.set",
      receiver: { resultHandle: "paragraphs", index: 0 },
      arguments: { value: "Recorded tide" }
    },
    {
      operation: "model.document.Document.core_properties.get",
      receiver: { resultHandle: "document" },
      arguments: {},
      resultHandle: "properties"
    },
    {
      operation: "model.opc.coreprops.CoreProperties.title.set",
      receiver: { resultHandle: "properties" },
      arguments: { value: "Tidal log" }
    }
  ];
  const batch = { version: 1, operations };
  const context = {
    ...textContext,
    timestamp: new Date("2026-09-16T00:00:00Z"),
    author: "Harbour recorder"
  };
  const cli = await execute(input, [
    "batch",
    "source.docx",
    "--ops-json",
    JSON.stringify(batch),
    "--timestamp",
    "2026-09-16T00:00:00Z",
    "--author",
    "Harbour recorder",
    "--output",
    "-"
  ]);
  expect(cli.exitCode, cli.stderr).toBe(0);
  const reopened = await Document(cli.bytes, textContext);
  expect(reopened.paragraphs[0]!.text).toBe("Recorded tide");
  expect(reopened.core_properties.title).toBe("Tidal log");
  const sdk = await applyStyleModelBatch(input, batch, context);
  const volume = Volume.fromJSON({ "/sdk.docx": "" });
  await sdk.save({
    async write(bytes) {
      volume.appendFileSync("/sdk.docx", bytes);
    }
  });
  const saved = await Document(
    new Uint8Array(volume.readFileSync("/sdk.docx") as Buffer),
    textContext
  );
  expect(saved.paragraphs[0]!.text).toBe("Recorded tide");
  expect(saved.core_properties.title).toBe("Tidal log");
  const help = await execute(input, ["help", "paragraphs", "set"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout).not.toContain("Model batches remain pending");
  const capabilities = await execute(input, ["capabilities", "--json"]);
  expect(capabilities.exitCode).toBe(0);
  const feature = JSON.parse(capabilities.stdout).data.features.find(
    (row: { id: string }) => row.id === "F30"
  );
  expect(JSON.stringify(feature)).not.toContain("No live CoreProperties/model");
  expect(feature.operationIds).toContain("model.opc.coreprops.CoreProperties.title.set");
});

it("executes inherited package views through their declared batch IDs", async () => {
  const input = await textFixture(paragraph("Original harbour report"));
  const operations = [
    {
      operation: "model.document.Document.part.get",
      receiver: { resultHandle: "document" },
      arguments: {},
      resultHandle: "part"
    },
    {
      operation: "model.parts.document.DocumentPart.package.get",
      receiver: { resultHandle: "part" },
      arguments: {},
      resultHandle: "package"
    },
    {
      operation: "model.package.Package.parts.get",
      receiver: { resultHandle: "package" },
      arguments: {},
      resultHandle: "parts"
    },
    {
      operation: "model.parts.document.DocumentPart.content_type.get",
      receiver: { resultHandle: "part" },
      arguments: {}
    }
  ];
  const cli = await execute(input, [
    "batch",
    "source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--json"
  ]);
  expect(cli.exitCode, cli.stderr).toBe(0);
  expect(JSON.parse(cli.stdout).data.results.at(-1).data).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
  );
  for (const operation of ["extract", "pack"]) {
    const help = await execute(input, ["help", operation]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).not.toContain("Live package models remain pending");
    expect(help.stdout).not.toContain(
      "Live package owners and generic packing batches remain pending"
    );
  }
});

it("exposes the inherited styles-part loader through its identical XML-part operation", async () => {
  const { StylePartView, XmlPartView } = await import("./index.js");
  expect(StylePartView.load).toBe(XmlPartView.load);
  const input = await textFixture(paragraph("Original harbour report"));
  const xml = new TextEncoder().encode("<harbour><tide>low</tide></harbour>");
  const doc = await Document(input, textContext);
  const loaded = await StylePartView.load(
    "/data/harbour.xml",
    "application/xml",
    xml,
    doc.store.package
  );
  expect(loaded).toBeInstanceOf(XmlPartView);
  expect(loaded.blob).toEqual(xml);
  const operations = [
    {
      operation: "model.document.Document.part.get",
      receiver: { resultHandle: "document" },
      arguments: {},
      resultHandle: "part"
    },
    {
      operation: "model.parts.document.DocumentPart.package.get",
      receiver: { resultHandle: "part" },
      arguments: {},
      resultHandle: "package"
    },
    {
      operation: "model.opc.part.XmlPart.load.call",
      arguments: {
        partname: "/data/harbour.xml",
        contentType: "application/xml",
        blob: { kind: "bytes", base64: btoa(new TextDecoder().decode(xml)) },
        ownerPackage: { resultHandle: "package" }
      },
      resultHandle: "loaded"
    },
    {
      operation: "model.opc.part.XmlPart.blob.get",
      receiver: { resultHandle: "loaded" },
      arguments: {}
    }
  ];
  const cli = await execute(input, [
    "batch",
    "source.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--dry-run",
    "--json"
  ]);
  expect(cli.exitCode, cli.stderr).toBe(0);
  expect(JSON.parse(cli.stdout).data.results.at(-1).data).toEqual({
    kind: "bytes",
    base64: btoa(new TextDecoder().decode(xml))
  });
});

it.each(["document", "package"] as const)(
  "maps %s save to one outer CLI publication without nested side effects",
  async (owner) => {
    const { PackageView, readArchive } = await import("./index.js");
    const input = await textFixture(paragraph("Original harbour report"));
    const model =
      owner === "document"
        ? await Document(input, textContext)
        : await PackageView.open(input, textContext);
    const volume = Volume.fromJSON({ "/sdk.docx": "" });
    await model.save({
      async write(bytes) {
        volume.appendFileSync("/sdk.docx", bytes);
      }
    });
    const reads = [
      {
        operation: "model.document.Document.paragraphs.get",
        receiver: { resultHandle: "document" },
        arguments: {}
      }
    ];
    const readOnly = await execute(input, [
      "batch",
      "source.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations: reads }),
      "--output",
      "-"
    ]);
    expect(readOnly.exitCode).toBe(2);
    expect(readOnly.bytes.length).toBe(0);
    const words = ["create", "--template", "source.docx", "--output", "-"];
    const cli = await execute(input, words);
    expect(cli.exitCode, cli.stderr).toBe(0);
    const sdkArchive = await readArchive(
      new Uint8Array(volume.readFileSync("/sdk.docx") as Buffer),
      textContext
    );
    const cliArchive = await readArchive(cli.bytes, textContext);
    const payloads = (archive: typeof cliArchive) =>
      archive.members
        .map(({ name, bytes }) => ({ name, bytes }))
        .sort((left, right) => left.name.localeCompare(right.name));
    expect(payloads(cliArchive)).toEqual(payloads(sdkArchive));
    expect(payloads(cliArchive)).toEqual(payloads(await readArchive(input, textContext)));
  }
);
