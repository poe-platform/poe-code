import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Ajv } from "ajv";
import {
  Document,
  NumberingPart,
  PackageView,
  PartView,
  DocumentBudget,
  InputTypeError,
  ResourceLimitError,
  StaleHandleError,
  SemanticValidationError,
  InvalidPackageError,
  readArchive,
  writeArchive,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  getDocxDiscovery,
  type DocxBatchOperation,
  type DocxSchemaData
} from "./index.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, assertWordReferences } from "../tests/assertions.js";
import { publication } from "../tests/fixtures/object-publication.js";

const operation = "model.parts.numbering.NumberingPart.new.call";
const ref = (resultHandle: string) => ({ resultHandle });
const operations: readonly DocxBatchOperation[] = [
  {
    operation: "model.document.Document.part.get",
    receiver: ref("document"),
    arguments: {},
    resultHandle: "main"
  },
  {
    operation: "model.parts.document.DocumentPart.package.get",
    receiver: ref("main"),
    arguments: {},
    resultHandle: "package"
  },
  { operation, arguments: { ownerPackage: ref("package") }, resultHandle: "numbering" },
  {
    operation: "model.parts.document.DocumentPart.numbering_part.get",
    receiver: ref("main"),
    arguments: {},
    resultHandle: "same"
  },
  {
    operation: "model.parts.numbering.NumberingPart.part.get",
    receiver: ref("numbering"),
    arguments: {}
  },
  { operation: "model.package.Package.parts.get", receiver: ref("package"), arguments: {} },
  {
    operation: "model.parts.numbering.NumberingPart.numbering_definitions.get",
    receiver: ref("numbering"),
    arguments: {},
    resultHandle: "definitions"
  },
  {
    operation: "model.NumberingDefinitionsView.length.get",
    receiver: ref("definitions"),
    arguments: {}
  }
];
const snapshot = (owner: PackageView) =>
  owner.parts.map((part) => [part.partname.toString(), part.blob]);

const malformedOverrides = [
  { name: "mismatched level", xml: '<w:lvl w:ilvl="1"/>' },
  { name: "missing level ID", xml: "<w:lvl/>" },
  { name: "negative level", xml: '<w:lvl w:ilvl="-1"/>' },
  { name: "level above eight", xml: '<w:lvl w:ilvl="9"/>' },
  { name: "duplicate level", xml: '<w:lvl w:ilvl="0"/><w:lvl w:ilvl="00"/>' },
  { name: "duplicate start", xml: '<w:startOverride w:val="1"/><w:startOverride w:val="2"/>' }
];

for (const route of ["model", "sdk", "cli"] as const) {
  for (const strict of [false, true]) {
    it.each(malformedOverrides)(
      `rejects malformed nested overrides through ${route}; strict=${strict}: $name`,
      async ({ xml }) => {
        const input = await textFixture(
          paragraph("Override ledger"),
          {
            numbering: {
              kind: "numbering",
              xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0">${xml}</w:lvlOverride></w:num></w:numbering>`
            }
          },
          strict
        );
        if (route === "model") {
          const model = await Document(input, textContext);
          const before = snapshot(model.part.package);
          const part = model.part.numbering_part;
          expect(() => NumberingPart.new(model.part.package)).toThrow(SemanticValidationError);
          expect(snapshot(model.part.package)).toEqual(before);
          expect(model.part.numbering_part).toBe(part);
          expect(part.numbering_definitions.length).toBe(1);
        } else if (route === "sdk") {
          await expect(
            applyStyleModelBatch(input, { version: 1, operations }, textContext)
          ).rejects.toThrow(SemanticValidationError);
        } else {
          const result = await command(input, operations, ["--output", "-"]);
          expect(result.result.exitCode).not.toBe(0);
          expect(result.stdout).toHaveLength(0);
        }
      }
    );
  }
}

it("rejects a mismatched XML level edit without invalidating retained definitions", async () => {
  const input = await textFixture(paragraph("Retained override"), {
    numbering: {
      kind: "numbering",
      xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="00"/></w:lvlOverride></w:num></w:numbering>`
    }
  });
  const model = await Document(input, textContext);
  const part = NumberingPart.new(model.part.package);
  const definitions = part.numbering_definitions;
  const level = part.element.children[1]!.children[1]!.children[0]!;
  const before = snapshot(model.part.package);
  expect(() => level.set_attribute({ namespaceURI: w, localName: "ilvl" }, "1")).toThrow(
    SemanticValidationError
  );
  expect(snapshot(model.part.package)).toEqual(before);
  expect(part.numbering_definitions).toBe(definitions);
  expect(definitions.length).toBe(1);
  level.set_attribute({ namespaceURI: w, localName: "ilvl" }, "+0");
  expect((await Document(await saved(model), textContext)).part.numbering_part.blob).toEqual(
    part.blob
  );
});

async function saved(model: {
  save(sink: { write(bytes: Uint8Array): Promise<void> }): Promise<void>;
}) {
  const volume = Volume.fromJSON({ "/output": "" });
  await model.save({
    async write(bytes) {
      volume.appendFileSync("/output", bytes);
    }
  });
  return new Uint8Array(volume.readFileSync("/output") as Buffer);
}
function preserved(
  before: ReadonlyMap<string, Uint8Array>,
  after: ReadonlyMap<string, Uint8Array>,
  changed: readonly string[]
) {
  for (const [name, bytes] of before)
    if (!changed.includes(name)) expect(after.get(name), name).toEqual(bytes);
  assertPackageLinks(after);
  assertWordReferences(after);
}

it.each([false, true])(
  "creates an attached empty numbering part and preserves unrelated bytes; strict=%s",
  async (strict) => {
    const input = await textFixture(paragraph("Harbor ledger"), {}, strict);
    const model = await Document(input, textContext);
    const paragraphHandle = model.paragraphs[0]!;
    const part: NumberingPart = NumberingPart.new(model.part.package);
    expect(part).toBeInstanceOf(NumberingPart);
    expect(part).not.toBeInstanceOf(Promise);
    expect(part.package).toBe(model.part.package);
    expect(model.part.numbering_part).toBe(part);
    expect(NumberingPart.new(model.part.package)).toBe(part);
    expect(part.numbering_definitions.length).toBe(0);
    expect(part.element.tag).toEqual({
      namespaceURI: strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w,
      localName: "numbering"
    });
    const edges = [...model.part.rels.values()].filter((edge) =>
      edge.reltype.endsWith("/numbering")
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target_part).toBe(part);
    expect(edges[0]!.is_external).toBe(false);
    expect(paragraphHandle.text).toBe("Harbor ledger");
    const output = await saved(model);
    preserved(readPackage(input), readPackage(output), [
      "[Content_Types].xml",
      "word/_rels/document.xml.rels"
    ]);
    const reopened = await Document(output, textContext);
    expect(reopened.part.numbering_part.numbering_definitions.length).toBe(0);
    expect(reopened.part.numbering_part.blob).toEqual(part.blob);
  }
);

it("creates through the documented getter without a separate constructor call", async () => {
  const model = await Document(await textFixture(paragraph("Estuary")), textContext);
  expect(model.part.numbering_part.package).toBe(model.part.package);
  expect(model.part.numbering_part.numbering_definitions.length).toBe(0);
});

it("creates missing relationship storage with admitted content types in one graph", async () => {
  const archive = await readArchive(
    await textFixture(paragraph("No owner relationships")),
    textContext
  );
  const input = await saved({
    save: (sink) =>
      writeArchive(
        {
          ...archive,
          members: archive.members.filter(
            (member) => member.name !== "word/_rels/document.xml.rels"
          )
        },
        sink,
        { order: "input", compression: "store" },
        textContext
      )
  });
  const model = await Document(input, textContext);
  NumberingPart.new(model.part.package);
  const output = readPackage(await saved(model));
  expect(output.has("word/_rels/document.xml.rels")).toBe(true);
  preserved(readPackage(input), output, ["[Content_Types].xml"]);
});

it("supports live authored definitions, rejects duplicate IDs and reloads the owned collection", async () => {
  const model = await Document(await textFixture(paragraph("Definition ledger")), textContext);
  const part = NumberingPart.new(model.part.package),
    definitions = part.numbering_definitions;
  const name = (localName: string) => ({ namespaceURI: w, localName });
  part.element.insert(0, {
    kind: "element",
    name: name("abstractNum"),
    attributes: [{ name: name("abstractNumId"), value: "2147483647" }]
  });
  const instance = {
    kind: "element" as const,
    name: name("num"),
    attributes: [{ name: name("numId"), value: "7" }],
    children: [
      {
        kind: "element" as const,
        name: name("abstractNumId"),
        attributes: [{ name: name("val"), value: "2147483647" }]
      }
    ]
  };
  part.element.insert(1, instance);
  expect(definitions.length).toBe(1);
  const before = part.blob;
  expect(() =>
    part.element.insert(2, { ...instance, attributes: [{ name: name("numId"), value: "007" }] })
  ).toThrow(SemanticValidationError);
  expect(part.blob).toEqual(before);
  expect(definitions.length).toBe(1);
  expect(
    (await Document(await saved(model), textContext)).part.numbering_part.numbering_definitions
      .length
  ).toBe(1);
});

it("allocates names and relationship IDs in the relocated owner's scope", async () => {
  const model = await Document(await textFixture(paragraph("Soundings")), textContext);
  const owner = model.part.package;
  const main = owner.main_document_part;
  main.partname = "/reports/volume.xml";
  const occupied = await PartView.load(
    "/reports/numbering1.xml",
    "application/octet-stream",
    new TextEncoder().encode('<ledger xmlns="urn:ledger"/>'),
    owner
  );
  main.relate_to(occupied, "urn:ledger:opaque");
  const before = snapshot(owner);
  const part = NumberingPart.new(owner);
  expect(part.partname.toString()).toBe("/reports/numbering2.xml");
  expect(main.rels.length).toBe(2);
  expect(main.part_related_by("urn:ledger:opaque")).toBe(occupied);
  expect(occupied.blob).toEqual(new TextEncoder().encode('<ledger xmlns="urn:ledger"/>'));
  expect(before.some(([name]) => name === part.partname.toString())).toBe(false);
  assertPackageLinks(readPackage(await saved(owner)));
});

it("reuses existing definitions with canonical integer identity without rewriting their spelling", async () => {
  const xml = `<w:numbering xmlns:w="${w}"><!--keep--><w:abstractNum w:abstractNumId="0002"><w:lvl w:ilvl="0"/></w:abstractNum><w:num w:numId="0007"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
  const model = await Document(
    await textFixture(paragraph("Survey"), { numbering: { kind: "numbering", xml } }),
    textContext
  );
  const before = snapshot(model.part.package);
  const part = NumberingPart.new(model.part.package);
  expect(part).toBe(model.part.numbering_part);
  expect(part.numbering_definitions.length).toBe(1);
  expect(snapshot(model.part.package)).toEqual(before);
});

it.each([
  '<w:abstractNum w:abstractNumId="2"/><w:abstractNum w:abstractNumId="02"/>',
  '<w:abstractNum w:abstractNumId="0"/><w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="007"><w:abstractNumId w:val="0"/></w:num>',
  '<w:abstractNum w:abstractNumId="-1"/>',
  '<w:abstractNum w:abstractNumId="2147483648"/>',
  '<w:abstractNum w:abstractNumId="9007199254740992"/>',
  '<w:num w:numId="1"><w:abstractNumId w:val="8"/></w:num>',
  '<w:num w:numId="1"/>',
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="9"/></w:abstractNum>',
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"/><w:lvl w:ilvl="00"/></w:abstractNum>'
])("validates malformed, ambiguous and safe existing definitions atomically: %s", async (content) => {
  const model = await Document(
    await textFixture(paragraph("Survey"), {
      numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}">${content}</w:numbering>` }
    }),
    textContext
  );
  const before = snapshot(model.part.package);
  if (content === '<w:abstractNum w:abstractNumId="2147483648"/>') {
    expect(NumberingPart.new(model.part.package)).toBe(model.part.numbering_part);
    expect(model.part.numbering_part.numbering_definitions.length).toBe(0);
    const after = readPackage(await saved(model));
    assertPackageLinks(after);
    expect(new TextDecoder().decode(after.get("word/numbering.xml"))).toContain(content);
  } else expect(() => NumberingPart.new(model.part.package)).toThrow(SemanticValidationError);
  expect(snapshot(model.part.package)).toEqual(before);
});

it("keeps existing definition-count inspection nonmutating while explicit creation rejects a dangling graph", async () => {
  const model = await Document(
    await textFixture(paragraph("Inspect stored definitions"), {
      numbering: {
        kind: "numbering",
        xml: `<w:numbering xmlns:w="${w}"><w:num w:numId="1"><w:abstractNumId w:val="9"/></w:num></w:numbering>`
      }
    }),
    textContext
  );
  const before = snapshot(model.part.package);
  expect(model.part.numbering_part.numbering_definitions.length).toBe(1);
  expect(() => NumberingPart.new(model.part.package)).toThrow(SemanticValidationError);
  expect(snapshot(model.part.package)).toEqual(before);
});

it("rejects duplicate ownership without guessing or publishing", async () => {
  const model = await Document(
    await textFixture(paragraph("Survey"), {
      numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"/>` }
    }),
    textContext
  );
  const part = model.part.numbering_part;
  model.part.load_rel(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
    part,
    "duplicate"
  );
  const before = snapshot(model.part.package);
  expect(() => NumberingPart.new(model.part.package)).toThrow();
  expect(snapshot(model.part.package)).toEqual(before);
});

it.each([
  `<w:styles xmlns:w="${w}"/>`,
  '<w:numbering xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"/>'
])("rejects an incompatible existing numbering root %s", async (xml) => {
  const input = await textFixture(paragraph("Keep"), { numbering: { kind: "numbering", xml } });
  const before = input.slice();
  await expect(
    Document(input, textContext).then((model) => NumberingPart.new(model.part.package))
  ).rejects.toThrow(InvalidPackageError);
  expect(input).toEqual(before);
});

it("rejects external numbering ownership without following or replacing it", async () => {
  const model = await Document(await textFixture(paragraph("Keep")), textContext);
  const before = snapshot(model.part.package);
  expect(() =>
    model.part.load_rel(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
      "https://example.invalid/numbering.xml",
      "external",
      true
    )
  ).toThrow(SemanticValidationError);
  expect(snapshot(model.part.package)).toEqual(before);
});

it("does not repair unrelated dangling numbering references by creating empty definitions", async () => {
  const model = await Document(
    await textFixture('<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:p>'),
    textContext
  );
  const before = snapshot(model.part.package);
  expect(() => NumberingPart.new(model.part.package)).toThrow(SemanticValidationError);
  expect(snapshot(model.part.package)).toEqual(before);
});

it("honors cancellation before allocating numbering", async () => {
  const controller = new AbortController();
  const model = await Document(await textFixture(paragraph("Keep")), {
    ...textContext,
    signal: controller.signal
  });
  const owner = model.part.package,
    revision = owner.revision;
  controller.abort();
  expect(() => NumberingPart.new(owner)).toThrow("cancelled");
  expect(owner.revision).toBe(revision);
});

it.each([undefined, null, {}, "package"])("requires an explicit admitted owner: %s", (value) => {
  expect(() => NumberingPart.new(value as PackageView)).toThrow(InputTypeError);
});

it("invalidates rolled-back created handles without losing retained paragraph/part identities", async () => {
  const model = await Document(await textFixture(paragraph("Keep")), textContext);
  const main = model.part,
    paragraphHandle = model.paragraphs[0]!,
    before = snapshot(main.package);
  let created: NumberingPart | undefined;
  expect(() =>
    model.store.transaction(() => {
      created = NumberingPart.new(main.package);
      throw new Error("Abort later operation");
    })
  ).toThrow("Abort later operation");
  expect(snapshot(main.package)).toEqual(before);
  expect(model.part).toBe(main);
  expect(paragraphHandle.text).toBe("Keep");
  expect(() => created!.partname).toThrow(StaleHandleError);
  expect(() => created!.numbering_definitions.length).toThrow(StaleHandleError);
  expect(NumberingPart.new(main.package)).not.toBe(created);
});

it.each([0, 1, 2])(
  "rolls back creation when inserted-node budget %i cannot admit the complete graph",
  async (insertedNodes) => {
    const budget = new DocumentBudget({ insertedNodes });
    const model = await Document(await textFixture(paragraph("Keep")), { ...textContext, budget });
    const before = snapshot(model.part.package),
      revision = model.part.package.revision;
    expect(() => NumberingPart.new(model.part.package)).toThrow(ResourceLimitError);
    expect(snapshot(model.part.package)).toEqual(before);
    expect(model.part.package.revision).toBe(revision);
  }
);

it("obeys archive-member bounds before adding any part", async () => {
  const input = await textFixture(paragraph("Keep"));
  const model = await Document(input, {
    ...textContext,
    limits: { ...textContext.limits, maxMembers: 4 }
  });
  const before = snapshot(model.part.package);
  expect(() => NumberingPart.new(model.part.package)).toThrow(ResourceLimitError);
  expect(snapshot(model.part.package)).toEqual(before);
});

it("leaves no staged graph when the final result-binding work exceeds its budget", async () => {
  const archive = await readArchive(await textFixture(paragraph("Budget boundary")), textContext);
  function owner(budget: DocumentBudget) {
    let current = archive,
      revision = 0;
    const value = new PackageView({
      context: { ...textContext, budget },
      snapshot: () => current,
      version: () => revision,
      writable() {},
      stage(candidate) {
        current = candidate;
        revision++;
      },
      async save() {}
    });
    return { value, current: () => current };
  }
  const budget = new DocumentBudget();
  NumberingPart.new(owner(budget).value);
  const limited = owner(new DocumentBudget({ work: budget.usage.work - 1 }));
  expect(() => NumberingPart.new(limited.value)).toThrow(ResourceLimitError);
  expect(limited.current()).toBe(archive);
});

it("executes typed SDK creation with usable result handles and reloadable output", async () => {
  const input = await textFixture(paragraph("SDK ledger"));
  const batch = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
  expect(batch.affected).toBe(1);
  expect(batch.results[2]!.value).toMatchObject({ type: "NumberingPart", owner: "document" });
  expect(batch.results[3]!.value).toEqual(batch.results[2]!.value);
  expect(batch.results.at(-1)!.value).toBe(0);
  const output = await saved(batch);
  preserved(readPackage(input), readPackage(output), [
    "[Content_Types].xml",
    "word/_rels/document.xml.rels"
  ]);
});

async function command(
  input: Uint8Array,
  items: unknown = operations,
  flags = ["--dry-run", "--json"]
) {
  const volume = Volume.fromJSON({
    "/input": Buffer.from(input),
    "/output": "Keep destination",
    "/stdout": "",
    "/stderr": ""
  });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: [
      "batch",
      "/input",
      "--ops-json",
      JSON.stringify({ version: 1, operations: items }),
      ...flags
    ].map((arg) => new TextEncoder().encode(arg)),
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
        volume.appendFileSync("/stdout", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        volume.appendFileSync("/stderr", bytes);
      }
    }
  });
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(volume.readFileSync("/output", "utf8")).toBe("Keep destination");
  return { result, stdout: new Uint8Array(volume.readFileSync("/stdout") as Buffer) };
}

it("routes actual CLI dry-run and binary publication through the same creation engine", async () => {
  const input = await textFixture(paragraph("CLI ledger"));
  const dry = await command(input);
  expect(dry.result.exitCode, new TextDecoder().decode(dry.stdout)).toBe(0);
  const envelope = JSON.parse(new TextDecoder().decode(dry.stdout));
  expect(envelope).toMatchObject({ ok: true, affected: 1, data: { publication: {dryRun: true, output: null} } });
  const published = await command(input, operations, ["--output", "-"]);
  expect(published.result.exitCode).toBe(0);
  preserved(readPackage(input), readPackage(published.stdout), [
    "[Content_Types].xml",
    "word/_rels/document.xml.rels"
  ]);
  expect(
    (await Document(published.stdout, textContext)).part.numbering_part.numbering_definitions.length
  ).toBe(0);
});

it.each([
  { operation, arguments: {} },
  { operation, arguments: { ownerPackage: ref("package"), surprise: true } },
  { operation, arguments: { ownerPackage: ref("numbering") } },
  {
    operation,
    arguments: { ownerPackage: { id: "old", type: "PackageView", owner: "elsewhere", revision: 1 } }
  },
  {
    operation: "model.parts.numbering.NumberingPart.blob.get",
    arguments: {},
    receiver: { resultHandle: "numbering", index: 1 }
  }
])("rejects invalid/stale batch handles and rolls back preceding creation: %j", async (item) => {
  const input = await textFixture(paragraph("Keep"));
  await expect(
    applyStyleModelBatch(input, { version: 1, operations: [...operations, item] }, textContext)
  ).rejects.toThrow();
  const result = await command(input, [...operations, item]);
  expect(result.result.exitCode).not.toBe(0);
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toMatchObject({
    ok: false,
    data: null,
    affected: 0
  });
});

it("does not publish without the required filesystem capabilities", async () => {
  const input = await textFixture(paragraph("Keep"));
  const result = await command(input, operations, ["--output", "/output", "--force", "--json"]);
  expect(result.result.exitCode).toBe(3);
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toMatchObject({
    ok: false,
    data: null,
    errors: [expect.objectContaining({ code: "unsupported-publication" })]
  });
});

it.each(["sdk", "cli"])(
  "publishes creation once through conditional VFS staging: %s",
  async (route) => {
    const input = await textFixture(paragraph("Published ledger")),
      env = publication(input);
    const publish = env.fs.publishStagedFile!.bind(env.fs);
    let publications = 0;
    env.fs.publishStagedFile = async (...args) => {
      publications++;
      return publish(...args);
    };
    if (route === "sdk") {
      const batch = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
      await batch.publish(
        {
          output: "/out/result.docx",
          input: { path: "/input.docx", stat: await env.fs.lstat("/input.docx") }
        },
        {
          ...textContext,
          filesystem: env.fs,
          encoding: { order: "input", compression: "store" }
        }
      );
    } else {
      const result = await createDocxInspectionCommandEngine({
        limits: textContext.limits
      }).execute({
        args: [
          "batch",
          "/input.docx",
          "--ops-json",
          JSON.stringify({ version: 1, operations }),
          "--output",
          "/out/result.docx"
        ].map((arg) => new TextEncoder().encode(arg)),
        cwd: "/",
        signal: textContext.signal,
        filesystem: env.fs,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write() {} },
        stderr: { async write() {} }
      });
      expect(result.exitCode).toBe(0);
    }
    expect(publications).toBe(1);
    expect(env.volume.readdirSync("/out")).toEqual(["result.docx"]);
    expect(env.volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    preserved(
      readPackage(input),
      readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Buffer)),
      ["[Content_Types].xml", "word/_rels/document.xml.rels"]
    );
  }
);

it("discovers a closed owner argument and a concrete NumberingPart result schema", async () => {
  expect(
    getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data
  ).toMatchObject({
    features: expect.arrayContaining([
      expect.objectContaining({
        id: "F18",
        subsets: expect.arrayContaining([
          expect.objectContaining({ name: "owned-numbering-part-creation", level: "edit" })
        ])
      })
    ])
  });
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!
    .data as DocxSchemaData;
  expect(data.operations[0]).toMatchObject({
    support: "edit",
    featureIds: expect.arrayContaining(["F01", "F18"])
  });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation } })!.human;
  expect(help).toContain("ownerPackage");
  const batch = await applyStyleModelBatch(
    await textFixture(paragraph("Schema")),
    { version: 1, operations },
    textContext
  );
  const validate = new Ajv({ strict: false }).compile(data.operations[0]!.result);
  expect(validate(batch.operationResults[2]), JSON.stringify(validate.errors)).toBe(true);
  expect(
    validate({
      ...batch.operationResults[2],
      data: { id: "placeholder", type: "PartView", owner: "document", revision: 0 }
    })
  ).toBe(false);
  for (const item of batch.operationResults) {
    const schema = (
      getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: item.operation } })!
        .data as DocxSchemaData
    ).operations[0]!.result;
    const check = new Ajv({ strict: false }).compile(schema);
    expect(check(item), `${item.operation}: ${JSON.stringify(check.errors)}`).toBe(true);
  }
});
