import { storedArchive } from "../tests/fixtures/archive.js";
import { readPackage } from "./package-reader.js";
import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFields, mutateFields } from "./fields.js";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
  validationLimits: {
    maxBytes: 8192,
    maxNodes: 1000,
    maxDepth: 32,
    maxParts: 32,
    maxRelationships: 64,
    maxEntries: 32
  }
};
async function fixture() {
  const bytes = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "雪 café 雪" }] }
      ]
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", bytes);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (publication: PptxPublicationRequest) => {
    if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  return {
    volume,
    bytes,
    readInput,
    publishOutput,
    run: (args: string[]) =>
      engine.execute({
        args: args.map(encode),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      })
  };
}
describe("field cache commands", () => {
  it.each(["slide-number", "date", "footer", "header"] as const)(
    "adds and edits explicit %s caches through SDK and CLI",
    async (kind) => {
      const f = await fixture();
      const timestamp = kind === "date" ? ["--timestamp", "2026-09-13T12:00:00Z"] : [];
      const out = await f.run([
        "fields",
        "add",
        "/deck.pptx",
        "--all",
        "--kind",
        kind,
        "--update",
        "explicit",
        "--text",
        "مرحبا 雪 é 🐚",
        ...timestamp,
        "--output",
        "/out.pptx",
        "--json"
      ]);
      expect(out.exitCode, decode(out.stdout) + decode(out.stderr)).toBe(0);
      const mutation = JSON.parse(decode(out.stdout)).data;
      expect(mutation.effects).toMatchObject([{ action: "add", feature: "F21" }]);
      expect(mutation.outputs).toMatchObject([{ path: "/out.pptx" }]);
      expect(mutation.fingerprint).toBe(mutation.outputs[0].sha256);
      const bytes = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
      expect(await readFields(bytes, {}, context)).toMatchObject([
        { kind, cachedText: "مرحبا 雪 é 🐚" }
      ]);
      const changed = await mutateFields(
        bytes,
        "set",
        {
          all: true,
          update: "explicit",
          text: "Caller value",
          ...(kind === "date" ? { timestamp: new Date("2000-01-01T00:00:00Z") } : {})
        },
        context
      );
      f.volume.writeFileSync("/changed.pptx", changed.bytes);
      const read = await f.run(["fields", "get", "/changed.pptx", "--json"]);
      expect(
        JSON.parse(decode(read.stdout)).data.items[0].fields.find(
          (field: { name: string }) => field.name === "cachedText"
        ).value.value
      ).toBe("Caller value");
      const schema = JSON.parse(decode((await f.run(["schema", "fields", "get", "--json"])).stdout))
        .data.operations["fields.get"];
      expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(read.stdout))).ok).toBe(
        true
      );
      const removed = await f.run([
        "fields",
        "remove",
        "/changed.pptx",
        "--all",
        "--output",
        "/removed.pptx",
        "--json"
      ]);
      expect(removed.exitCode).toBe(0);
      expect(
        await readFields(
          new Uint8Array(f.volume.readFileSync("/removed.pptx") as Buffer),
          {},
          context
        )
      ).toEqual([]);
    }
  );
  it.each([
    ["--kind", "date", "--update", "explicit", "--text", "x"],
    [
      "--kind",
      "date",
      "--update",
      "explicit",
      "--text",
      "x",
      "--timestamp",
      "2026-02-30T00:00:00Z"
    ],
    ["--kind", "date", "--update", "explicit", "--text", "x", "--timestamp", "2026-09-13"],
    ["--kind", "footer", "--text", "x"],
    ["--kind", "footer", "--update", "explicit"],
    ["--kind", "header", "--update", "preserve", "--timestamp", "2026-09-13T00:00:00Z"]
  ])("rejects invalid policy before input admission", async (...flags) => {
    const f = await fixture();
    expect(
      (await f.run(["fields", "add", "/deck.pptx", "--all", "--dry-run", ...flags])).exitCode
    ).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("keeps empty lists distinct from missing singular reads and advertises fields", async () => {
    const f = await fixture();
    expect(
      JSON.parse(decode((await f.run(["fields", "list", "/deck.pptx", "--json"])).stdout)).data
        .items
    ).toEqual([]);
    expect((await f.run(["fields", "get", "/deck.pptx"])).exitCode).toBe(1);
    expect(decode((await f.run(["fields", "set", "--help"])).stdout)).toContain("--update");
  });
});
it("allows explicit empty set/remove and rejects multiple add owners", async () => {
  const f = await fixture();
  for (const action of ["set", "remove"]) {
    const out = await f.run([
      "fields",
      action,
      "/deck.pptx",
      "--all",
      "--allow-empty",
      "--dry-run",
      "--json",
      ...(action === "set" ? ["--update", "preserve"] : [])
    ]);
    expect(out.exitCode, decode(out.stdout)).toBe(0);
    expect(JSON.parse(decode(out.stdout)).affected).toBe(0);
    expect(JSON.parse(decode(out.stdout)).data).toEqual({
      effects: [],
      outputs: [],
      fingerprint: null
    });
  }
  const deck = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { name: "One", x: 0, y: 0, width: 10, height: 10, text: "A" },
            { name: "Two", x: 0, y: 0, width: 10, height: 10, text: "B" }
          ]
        }
      ]
    },
    context
  );
  await expect(mutateFields(deck, "add", { all: true, kind: "footer" }, context)).rejects.toThrow();
});
it("advertises policy and publication constraints in closed field schemas", async () => {
  const f = await fixture();
  const schemas = JSON.parse(decode((await f.run(["schema", "fields", "add", "--json"])).stdout))
    .data.operations;
  const schema = compileJsonSchema(schemas["fields.add"].options);
  for (const value of [
    { kind: "footer", all: true, dryRun: true },
    {
      kind: "date",
      update: "explicit",
      text: "x",
      timestamp: "2026-09-13T00:00:00Z",
      slide: 1,
      output: "/out.pptx"
    }
  ])
    expect(schema.validate(value).ok).toBe(true);
  for (const value of [
    { kind: "footer", all: false, dryRun: true },
    { kind: "footer", all: true },
    { kind: "footer", all: true, dryRun: true, text: "x" },
    { kind: "date", update: "explicit", text: "x", all: true, dryRun: true },
    { kind: "footer", all: true, output: "/a", inPlace: true }
  ])
    expect(schema.validate(value).ok, JSON.stringify(value)).toBe(false);
});
it("keeps field help readable and exposes publication controls", async () => {
  const f = await fixture();
  const text = decode((await f.run(["fields", "set", "--help"])).stdout);
  expect(text.split("\n").every((line) => line.length <= 80)).toBe(true);
  for (const flag of ["--allow-empty", "--force", "--update", "--timestamp", "--shape NAME"])
    expect(text).toContain(flag);
});
async function originalFieldDeck(type: string, extraInline = "") {
  const f = await fixture();
  const archive = await readPackage(f.bytes, context);
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const xml = `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Caption"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr vert="eaVert"/><a:lstStyle/><a:p><a:pPr rtl="1"><a:defRPr lang="ar-SA"><a:latin typeface="Meadow"/><a:ea typeface="Harbor"/><a:cs typeface="Garden"/></a:defRPr></a:pPr><a:r><a:t>Before é 🐚 </a:t></a:r>${extraInline}<a:fld id="{00000000-0000-0000-0000-000000000001}" type="${type}"><a:rPr b="1"/><a:t>旧 قيمة</a:t></a:fld><a:r><a:t> After</a:t></a:r><a:endParaRPr lang="ja-JP"/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const bytes = storedArchive(
    archive.names.map((name) => ({
      name: name.slice(1),
      bytes: name === "/ppt/slides/slide1.xml" ? encode(xml) : archive.get(name)
    }))
  );
  f.volume.writeFileSync("/deck.pptx", bytes);
  return { ...f, bytes, xml };
}
it("reports an unsupported existing field as an edit failure without publication", async () => {
  const f = await originalFieldDeck("custom-value");
  await expect(
    mutateFields(f.bytes, "set", { all: true, update: "explicit", text: "new" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
  const out = await f.run([
    "fields",
    "set",
    "/deck.pptx",
    "--all",
    "--update",
    "explicit",
    "--text",
    "new",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(out.exitCode).toBe(1);
  expect(JSON.parse(decode(out.stdout)).errors).toMatchObject([{ code: "unsupported-edit" }]);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.bytes);
});
it("retains inherited mixed-script metadata and appends deterministic fields before ending metadata", async () => {
  const f = await originalFieldDeck("slidenum");
  const options = {
    select: {
      kind: "slide" as const,
      position: { coordinateSystem: "one-based" as const, value: 1 }
    },
    shape: "Caption",
    kind: "footer" as const,
    update: "explicit" as const,
    text: "末尾 é 🐚"
  };
  const first = await mutateFields(f.bytes, "add", options, context);
  const repeat = await mutateFields(f.bytes, "add", options, context);
  expect(first.bytes).toEqual(repeat.bytes);
  const before = await readPackage(f.bytes, context);
  const after = await readPackage(first.bytes, context);
  expect(after.names).toEqual(before.names);
  for (const name of before.names)
    if (name !== "/ppt/slides/slide1.xml") expect(after.get(name), name).toEqual(before.get(name));
  const xml = decode(after.get("/ppt/slides/slide1.xml"));
  expect(xml).toContain(
    '<a:pPr rtl="1"><a:defRPr lang="ar-SA"><a:latin typeface="Meadow"/><a:ea typeface="Harbor"/><a:cs typeface="Garden"/></a:defRPr></a:pPr>'
  );
  expect(xml).toContain('<a:bodyPr vert="eaVert"/>');
  expect(xml).toContain('<a:rPr b="1"/><a:t>旧 قيمة</a:t>');
  expect(xml).toContain('id="{00000000-0000-0000-0000-000000000002}"');
  expect(xml).toContain("末尾 é 🐚");
  expect(xml.indexOf("末尾 é 🐚")).toBeLessThan(xml.indexOf("a:endParaRPr"));
});

it.each([
  ["", 1],
  ['<p:fld id="opaque"><p:t>Retain opaque</p:t></p:fld>', 1],
  ["<a:br/>", 2]
] as const)(
  "counts only text inlines and retains foreign field metadata",
  async (extraInline, inline) => {
    const f = await originalFieldDeck("slidenum", extraInline);
    expect(await readFields(f.bytes, {}, context)).toMatchObject([
      { paragraph: 0, inline, fieldType: "slidenum", cachedText: "旧 قيمة" }
    ]);
    expect((await readFields(f.bytes, {}, context)).length).toBe(1);
    const read = await f.run(["fields", "get", "/deck.pptx", "--json"]);
    expect(read.exitCode).toBe(0);
    const properties = JSON.parse(decode(read.stdout)).data.items[0].fields;
    expect(properties.find((field: { name: string }) => field.name === "inline").value).toEqual({
      type: "number",
      value: inline
    });
    const changed = await mutateFields(
      f.bytes,
      "set",
      { all: true, update: "explicit", text: "Caller cache" },
      context
    );
    expect(changed.affected).toBe(1);
    const xml = decode((await readPackage(changed.bytes, context)).get("/ppt/slides/slide1.xml"));
    expect(xml).toContain('<a:rPr b="1"/><a:t>Caller cache</a:t>');
    expect(xml).toContain('<a:endParaRPr lang="ja-JP"/>');
    expect(xml).toContain('<a:pPr rtl="1"><a:defRPr lang="ar-SA">');
    if (extraInline) expect(xml).toContain(extraInline);
    const removed = await mutateFields(f.bytes, "remove", { all: true }, context);
    expect(removed.affected).toBe(1);
    const removedXml = decode(
      (await readPackage(removed.bytes, context)).get("/ppt/slides/slide1.xml")
    );
    expect(removedXml).not.toContain("<a:fld");
    if (extraInline) expect(removedXml).toContain(extraInline);
  }
);
