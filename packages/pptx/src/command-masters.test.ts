import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";

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
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 262144
});
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
let original: Promise<Uint8Array> | undefined;
async function fixture() {
  original ??= createPresentation(
    {
      slides: [
        { shapes: [{ x: 100, y: 200, width: 300, height: 400, text: "Canvas stays independent" }] }
      ]
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", await original);
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
    async run(args: string[]) {
      const result = await engine.execute({
        args: [...args, "--json"].map((value) => new TextEncoder().encode(value)),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      });
      return { ...result, envelope: JSON.parse(new TextDecoder().decode(result.stdout)) };
    }
  };
}

describe("shared master commands", () => {
  it("renames a master with shared scope and reports dependent slides", async () => {
    const f = await fixture();
    const changed = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--part",
      "/ppt/slideMasters/slideMaster1.xml",
      "--scope",
      "shared",
      "--name",
      "Coastal",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    expect(changed.envelope).toMatchObject({
      operation: "masters.set",
      affected: 1,
      data: { affectedSlides: [1] }
    });
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    expect(
      new TextDecoder().decode(
        entries.find((entry) => entry.name === "ppt/slideMasters/slideMaster1.xml")!.payload
      )
    ).toContain('name="Coastal"');
    const listed = await f.run(["masters", "list", "/deck.pptx"]);
    expect(listed.envelope.data.records).toMatchObject([{ name: "Coastal", affectedSlides: [1] }]);
    for (const action of ["list", "get", "add", "set"]) {
      const schema = await f.run(["schema", "masters", action]);
      expect(schema.exitCode).toBe(0);
      const declaration = schema.envelope.data.operations[`masters.${action}`];
      expect(declaration).toBeDefined();
      if (action === "list" || action === "set")
        expect(
          compileJsonSchema(declaration.result).validate(
            action === "list" ? listed.envelope : changed.envelope
          ).ok
        ).toBe(true);
    }
  });

  it("adds a text master then edits a selected shape without touching slide bytes", async () => {
    const f = await fixture();
    const added = await f.run([
      "masters",
      "add",
      "/deck.pptx",
      "--scope",
      "shared",
      "--name",
      "Harbor",
      "--in-place"
    ]);
    expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
    expect(added.envelope.data.affectedSlides).toEqual([]);
    const part = added.envelope.data.part;
    const shape = await f.run([
      "shapes",
      "add",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "text-box",
      "--name",
      "Footer",
      "--left",
      "1emu",
      "--top",
      "2emu",
      "--width",
      "300emu",
      "--height",
      "400emu",
      "--text",
      "First",
      "--in-place"
    ]);
    expect(shape.exitCode, JSON.stringify(shape.envelope)).toBe(0);
    const background = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "solid",
      "--color",
      "AABBCC",
      "--in-place"
    ]);
    expect(background.exitCode, JSON.stringify(background.envelope)).toBe(0);
    const changed = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--part",
      part,
      "--scope",
      "shared",
      "--shape",
      "Footer",
      "--text",
      "Second",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const xml = new TextDecoder().decode(
      entries.find((entry) => entry.name === part.slice(1))!.payload
    );
    expect(xml).toContain("Second");
    expect(xml).not.toContain("First");
    expect(xml).toContain('val="AABBCC"');
    const source = inspectZip(await original!);
    expect(entries.find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload).toEqual(
      source.find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload
    );
    const associated = await f.run([
      "layouts",
      "set",
      "/deck.pptx",
      "--part",
      "/ppt/slideLayouts/slideLayout1.xml",
      "--scope",
      "shared",
      "--master",
      part,
      "--in-place"
    ]);
    expect(associated.exitCode, JSON.stringify(associated.envelope)).toBe(0);
    expect(associated.envelope.data.affectedSlides).toEqual([1]);
  });

  it.each([
    ["masters", "set", "--name", "Renamed"],
    ["masters", "set", "--scope", "slides", "--name", "Renamed"],
    ["masters", "set", "--scope", "shared", "--text", "Unselected"],
    ["masters", "add", "--scope", "shared"],
    ["layouts", "set", "--scope", "shared", "--name", "Unsupported"]
  ])("rejects invalid master options before reading: %j", async (family, action, ...flags) => {
    const f = await fixture();
    const result = await f.run([family, action, "/deck.pptx", ...flags, "--dry-run"]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("edits selected shape geometry and exposes object locations through matching schemas", async () => {
    const f = await fixture();
    const part = "/ppt/slideMasters/slideMaster1.xml";
    const added = await f.run([
      "shapes",
      "add",
      "/deck.pptx",
      "--part",
      part,
      "--scope",
      "masters",
      "--kind",
      "text-box",
      "--left",
      "0emu",
      "--top",
      "0emu",
      "--width",
      "500emu",
      "--height",
      "600emu",
      "--name",
      "Caption",
      "--text",
      "Old",
      "--in-place"
    ]);
    expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
    const changed = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--part",
      part,
      "--scope",
      "masters",
      "--shape",
      "Caption",
      "--left",
      "100emu",
      "--top",
      "200emu",
      "--width",
      "700emu",
      "--height",
      "800emu",
      "--name",
      "Label",
      "--text",
      "New",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    expect(changed.envelope).toMatchObject({ affected: 1, data: { affectedSlides: [1] } });
    expect(changed.envelope.locations[0].objectId).toBe("2");
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const xml = new TextDecoder().decode(
      entries.find((entry) => entry.name === part.slice(1))!.payload
    );
    expect(xml).toContain('name="Label"');
    expect(xml).toContain('x="100"');
    expect(xml).toContain('y="200"');
    expect(xml).toContain('cx="700"');
    expect(xml).toContain('cy="800"');
    expect(xml).toContain("New");
    for (const [family, action, envelope] of [
      ["shapes", "add", added.envelope],
      ["shapes", "set", changed.envelope]
    ] as const) {
      const schema = await f.run(["schema", family, action]);
      expect(
        compileJsonSchema(schema.envelope.data.operations[`${family}.${action}`].result).validate(
          envelope
        ).ok
      ).toBe(true);
    }
  });

  it("rejects stale selectors and cross-scope selectors before publication", async () => {
    const f = await fixture();
    const inspected = await f.run([
      "inspect",
      "/deck.pptx",
      "--part",
      "/ppt/slideMasters/slideMaster1.xml",
      "--scope",
      "masters"
    ]);
    const token = inspected.envelope.data.records[0].token;
    const changed = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--scope",
      "shared",
      "--select",
      token,
      "--name",
      "Revised",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    f.publishOutput.mockClear();
    const stale = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--scope",
      "shared",
      "--select",
      token,
      "--name",
      "Stale",
      "--in-place"
    ]);
    expect(stale.envelope.errors[0].code).toBe("stale-selection");
    expect(f.publishOutput).not.toHaveBeenCalled();
    const slide = await f.run(["inspect", "/deck.pptx", "--slide", "1"]);
    const invalid = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--scope",
      "shared",
      "--select",
      slide.envelope.data.records[0].token,
      "--name",
      "Foreign",
      "--in-place"
    ]);
    expect(invalid.envelope.errors[0].code).toBe("invalid-selection");
    expect(f.publishOutput).not.toHaveBeenCalled();
  });

  it("requires explicit all for multiple masters and validates dry runs without publication", async () => {
    const f = await fixture();
    expect(
      (
        await f.run([
          "masters",
          "add",
          "/deck.pptx",
          "--scope",
          "masters",
          "--name",
          "Other",
          "--in-place"
        ])
      ).exitCode
    ).toBe(0);
    f.publishOutput.mockClear();
    const ambiguous = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--name",
      "Updated",
      "--dry-run"
    ]);
    expect(ambiguous.envelope.errors[0].code).toBe("ambiguous-selection");
    const all = await f.run([
      "masters",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--name",
      "Updated",
      "--all",
      "--dry-run"
    ]);
    expect(all.exitCode, JSON.stringify(all.envelope)).toBe(0);
    expect(all.envelope).toMatchObject({
      affected: 2,
      data: { affectedSlides: [1], outputs: [], fingerprint: null }
    });
    expect(f.publishOutput).not.toHaveBeenCalled();
  });

  it("uses numeric shape names literally and supports identity tokens independently", async () => {
    const f = await fixture();
    const part = "/ppt/slideMasters/slideMaster1.xml";
    for (const name of ["Other", "2"]) {
      const added = await f.run([
        "shapes",
        "add",
        "/deck.pptx",
        "--scope",
        "masters",
        "--part",
        part,
        "--kind",
        "text-box",
        "--left",
        "0emu",
        "--top",
        "0emu",
        "--width",
        "300emu",
        "--height",
        "400emu",
        "--name",
        name,
        "--text",
        name,
        "--in-place"
      ]);
      expect(added.exitCode).toBe(0);
    }
    const renamed = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "2",
      "--text",
      "Numeric name",
      "--in-place"
    ]);
    expect(renamed.exitCode, JSON.stringify(renamed.envelope)).toBe(0);
    expect(renamed.envelope.locations).toMatchObject([{ owner: part, objectId: "3" }]);
    f.publishOutput.mockClear();
    const missing = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "3",
      "--text",
      "Must not edit id 3",
      "--in-place"
    ]);
    expect(missing.envelope.errors[0].code).toBe("missing-selection");
    expect(f.publishOutput).not.toHaveBeenCalled();
    const inspected = await f.run([
      "inspect",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "Other"
    ]);
    const changed = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--select",
      inspected.envelope.data.records[0].token,
      "--text",
      "Identity",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    expect(changed.envelope.locations).toMatchObject([{ owner: part, objectId: "2" }]);
  });

  it("resets explicit master backgrounds to inheritance and treats repeated resets as no change", async () => {
    const f = await fixture();
    const part = "/ppt/slideMasters/slideMaster1.xml";
    const solid = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "solid",
      "--color",
      "123456",
      "--in-place"
    ]);
    expect(solid.exitCode).toBe(0);
    const reset = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "inherit",
      "--in-place"
    ]);
    expect(reset.exitCode, JSON.stringify(reset.envelope)).toBe(0);
    expect(reset.envelope).toMatchObject({ affected: 1, data: { affectedSlides: [1] } });
    const schema = await f.run(["schema", "backgrounds", "set"]);
    expect(
      compileJsonSchema(schema.envelope.data.operations["backgrounds.set"].result).validate(
        reset.envelope
      ).ok
    ).toBe(true);
    const unchanged = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "inherit",
      "--in-place"
    ]);
    expect(unchanged.exitCode).toBe(0);
    expect(unchanged.envelope).toMatchObject({ affected: 0, data: { effects: [] } });
    f.publishOutput.mockClear();
    const invalid = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "inherit",
      "--color",
      "123456",
      "--in-place"
    ]);
    expect(invalid.exitCode).toBe(2);
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("edits duplicate shape names only with all and honors explicitly empty shape selection", async () => {
    const f = await fixture();
    const part = "/ppt/slideMasters/slideMaster1.xml";
    for (let count = 0; count < 2; count++)
      expect(
        (
          await f.run([
            "shapes",
            "add",
            "/deck.pptx",
            "--scope",
            "masters",
            "--part",
            part,
            "--kind",
            "text-box",
            "--left",
            "0emu",
            "--top",
            "0emu",
            "--width",
            "300emu",
            "--height",
            "400emu",
            "--name",
            "Repeated",
            "--in-place"
          ])
        ).exitCode
      ).toBe(0);
    const ambiguous = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "Repeated",
      "--text",
      "New",
      "--dry-run"
    ]);
    expect(ambiguous.envelope.errors[0].code).toBe("ambiguous-selection");
    const all = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "Repeated",
      "--all",
      "--text",
      "New",
      "--in-place"
    ]);
    expect(all.exitCode, JSON.stringify(all.envelope)).toBe(0);
    expect(all.envelope).toMatchObject({ affected: 2, data: { part, affectedSlides: [1] } });
    expect(
      all.envelope.locations.map((location: { objectId: string }) => location.objectId)
    ).toEqual(["2", "3"]);
    const empty = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "Absent",
      "--allow-empty",
      "--text",
      "New",
      "--dry-run"
    ]);
    expect(empty.exitCode, JSON.stringify(empty.envelope)).toBe(0);
    expect(empty.envelope).toMatchObject({ affected: 0, data: { effects: [] } });
  });
  it("accepts negative shape positions while requiring positive dimensions", async () => {
    const f = await fixture();
    const part = "/ppt/slideMasters/slideMaster1.xml";
    const added = await f.run([
      "shapes",
      "add",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--kind",
      "text-box",
      "--left",
      "-1in",
      "--top",
      "-2pt",
      "--width",
      "300emu",
      "--height",
      "400emu",
      "--name",
      "Outside",
      "--in-place"
    ]);
    expect(added.exitCode, JSON.stringify(added.envelope)).toBe(0);
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const xml = new TextDecoder().decode(
      entries.find((entry) => entry.name === part.slice(1))!.payload
    );
    expect(xml).toContain('x="-914400"');
    expect(xml).toContain('y="-25400"');
    const changed = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "Outside",
      "--left",
      "-3cm",
      "--top",
      "-4mm",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    const changedEntries = inspectZip(
      new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)
    );
    const changedXml = new TextDecoder().decode(
      changedEntries.find((entry) => entry.name === part.slice(1))!.payload
    );
    expect(changedXml).toContain('x="-1080000"');
    expect(changedXml).toContain('y="-144000"');
    const rounded = await f.run([
      "shapes",
      "set",
      "/deck.pptx",
      "--scope",
      "masters",
      "--part",
      part,
      "--shape",
      "Outside",
      "--left",
      "-0.5emu",
      "--top",
      "0.5emu",
      "--in-place"
    ]);
    expect(rounded.exitCode, JSON.stringify(rounded.envelope)).toBe(0);
    const roundedEntries = inspectZip(
      new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)
    );
    const roundedXml = new TextDecoder().decode(
      roundedEntries.find((entry) => entry.name === part.slice(1))!.payload
    );
    expect(roundedXml).toContain('x="-1"');
    expect(roundedXml).toContain('y="1"');
    for (const action of ["add", "set"]) {
      const schema = await f.run(["schema", "shapes", action]);
      const options = compileJsonSchema(
        schema.envelope.data.operations[`shapes.${action}`].options
      );
      const input = {
        scope: "masters",
        part,
        left: { value: -1, unit: "in" },
        top: { value: -2, unit: "pt" },
        width: { value: 300, unit: "emu" },
        height: { value: 400, unit: "emu" },
        dryRun: true,
        ...(action === "add" ? { kind: "text-box" } : { shape: "Outside" })
      };
      expect(options.validate(input).ok).toBe(true);
      expect(options.validate({ ...input, width: { value: -1, unit: "in" } }).ok).toBe(false);
    }
    for (const [flag, value] of [
      ["--width", "-1in"],
      ["--height", "0emu"],
      ["--left", "-27273042316901emu"],
      ["--left", "--1in"],
      ["--top", "-.5in"]
    ]) {
      f.publishOutput.mockClear();
      const invalid = await f.run([
        "shapes",
        "set",
        "/deck.pptx",
        "--scope",
        "masters",
        "--part",
        part,
        "--shape",
        "Outside",
        flag!,
        value!,
        "--in-place"
      ]);
      expect(invalid.exitCode).toBe(2);
      expect(f.publishOutput).not.toHaveBeenCalled();
    }
  });
});
