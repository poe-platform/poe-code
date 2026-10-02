import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number) =>
    delay === 0 ? setImmediate(fn) : timer(fn, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function fixture() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync(
    "/deck",
    await createPresentation(
      {
        slides: [
          {
            shapes: ["Garden", "Gate"].map((name) => ({
              name,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              text: name
            }))
          }
        ]
      },
      context
    )
  );
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  });
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (publication: PptxPublicationRequest) => {
    if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
  });
  return {
    volume,
    readInput,
    publishOutput,
    run: async (args: string[]) => {
      const result = await engine.execute({
        args: args.map((arg) => new TextEncoder().encode(arg)),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      });
      const text = new TextDecoder().decode(result.stdout);
      return { ...result, text, envelope: args.includes("--json") ? JSON.parse(text) : undefined };
    }
  };
}
it("publishes alternative text and decorative metadata with closed result schemas", async () => {
  const f = await fixture();
  const updated = await f.run([
    "accessibility",
    "set",
    "/deck",
    "--slide",
    "1",
    "--shape",
    "Garden",
    "--alt-text",
    "A green courtyard & two benches",
    "--title",
    "Courtyard",
    "--decorative",
    "false",
    "--in-place",
    "--json"
  ]);
  expect(updated.exitCode, updated.text).toBe(0);
  expect(updated.envelope.affected).toBe(1);
  const listed = await f.run([
    "accessibility",
    "get",
    "/deck",
    "--slide",
    "1",
    "--shape",
    "Garden",
    "--json"
  ]);
  expect(listed.exitCode, listed.text).toBe(0);
  expect(listed.envelope.data.objects).toMatchObject([
    {
      title: "Courtyard",
      altText: "A green courtyard & two benches",
      description: "A green courtyard & two benches",
      decorative: false
    }
  ]);
  expect(listed.envelope.data.order).toBe("structural");
  const schema = (await f.run(["schema", "accessibility", "get", "--json"])).envelope.data
    .operations["accessibility.get"];
  const validator = compileJsonSchema(schema.result);
  expect(validator.validate(listed.envelope).ok).toBe(true);
  delete listed.envelope.data.objects[0].structuralOrder;
  expect(validator.validate(listed.envelope).ok).toBe(false);
});
it("requires explicit edits and selectors before reading input", async () => {
  const f = await fixture();
  for (const flags of [
    ["--slide", "1"],
    ["--alt-text", "Text"],
    ["--slide", "1", "--decorative", "yes"],
    ["--slide", "1", "--description", "Text"],
    ["--shape", "Garden", "--title", "Title"]
  ]) {
    const result = await f.run(["accessibility", "set", "/deck", ...flags, "--dry-run", "--json"]);
    expect(result.exitCode, result.text).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
});
it("keeps dry runs unchanged and rejects ambiguous get or implicit bulk edits", async () => {
  const f = await fixture();
  const original = f.volume.readFileSync("/deck");
  for (const args of [["get"], ["set", "--slide", "1", "--alt-text", "Text", "--dry-run"]]) {
    const [action, ...flags] = args;
    expect((await f.run(["accessibility", action!, "/deck", ...flags, "--json"])).exitCode).toBe(1);
  }
  const dry = await f.run([
    "accessibility",
    "set",
    "/deck",
    "--all",
    "--alt-text",
    "",
    "--decorative",
    "true",
    "--dry-run",
    "--json"
  ]);
  expect(dry.exitCode, dry.text).toBe(0);
  expect(dry.envelope.affected).toBe(2);
  expect(f.volume.readFileSync("/deck")).toEqual(original);
  const list = await f.run(["accessibility", "list", "/deck", "--json"]);
  expect(
    list.envelope.data.objects.map((object: { structuralOrder: number }) => object.structuralOrder)
  ).toEqual([1, 2]);
  expect(list.envelope.data.slides).toMatchObject([{ slide: 1, missingTitle: true }]);
  const token = list.envelope.data.objects[0].token;
  expect(
    (
      await f.run([
        "accessibility",
        "set",
        "/deck",
        "--select",
        token,
        "--title",
        "Via token",
        "--dry-run",
        "--json"
      ])
    ).exitCode
  ).toBe(0);
});
it("advertises structural limits and all accessibility operations without I/O", async () => {
  const f = await fixture();
  const help = await f.run(["accessibility", "--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.text).toContain("structural");
  expect(help.text).toContain("--alt-text");
  const schema = await f.run(["schema", "accessibility", "--json"]);
  expect(Object.keys(schema.envelope.data.operations)).toEqual([
    "accessibility.list",
    "accessibility.get",
    "accessibility.set"
  ]);
  expect((await f.run(["capabilities", "--json"])).text).toContain("accessibility");
  expect(f.readInput).not.toHaveBeenCalled();
});
it("rejects shared scope consistently in discovery and parsing before input reads", async () => {
  const f = await fixture();
  const schema = await f.run(["schema", "accessibility", "list", "--json"]);
  const options = compileJsonSchema(schema.envelope.data.operations["accessibility.list"].options);
  expect(options.validate({ scope: "shared" }).ok).toBe(false);
  const result = await f.run(["accessibility", "list", "/deck", "--scope", "shared", "--json"]);
  expect(result.exitCode, result.text).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
});
it("edits a shared layout object through its opaque token and reports affected slides", async () => {
  const f = await fixture();
  const input = new Uint8Array(f.volume.readFileSync("/deck") as Buffer);
  const layout =
    '<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Layout emblem"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld></p:sldLayout>';
  f.volume.writeFileSync(
    "/deck",
    await writePackageArchive(
      inspectZip(input).map((member) => ({
        name: member.name,
        bytes:
          member.name === "ppt/slideLayouts/slideLayout1.xml"
            ? new TextEncoder().encode(layout)
            : member.payload
      })),
      context,
      { compression: "auto" }
    )
  );
  const listed = await f.run(["accessibility", "list", "/deck", "--scope", "layouts", "--json"]);
  expect(listed.exitCode, listed.text).toBe(0);
  expect(listed.envelope.data.objects).toMatchObject([{ name: "Layout emblem", inheritedBy: [1] }]);
  const token = listed.envelope.data.objects[0].token;
  const set = await f.run([
    "accessibility",
    "set",
    "/deck",
    "--select",
    token,
    "--title",
    "Company emblem",
    "--decorative",
    "true",
    "--in-place",
    "--json"
  ]);
  expect(set.exitCode, set.text).toBe(0);
  expect(set.envelope.data.affectedSlides).toEqual([1]);
  const human = await f.run(["accessibility", "get", "/deck", "--scope", "layouts"]);
  expect(human.text).toContain("Company emblem");
  expect(human.text).toContain("decorative=true");
});
