import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { mutatePresentationSettings, readPresentationSettings } from "./index.js";
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

describe("presentation settings commands", () => {
  it.each(["list", "get", "set"])(
    "provides settings %s help without document I/O",
    async (action) => {
      for (const flag of ["--help", "-h"]) {
        const readInput = vi.fn(async () => {
          throw new Error("Unexpected input read");
        });
        const publishOutput = vi.fn();
        const result = await engine.execute({
          args: ["settings", action, flag, "--json"].map((value) =>
            new TextEncoder().encode(value)
          ),
          signal: new AbortController().signal,
          readInput,
          publishOutput
        });
        expect(result.exitCode).toBe(0);
        const envelope = JSON.parse(new TextDecoder().decode(result.stdout));
        expect(envelope.operation).toBe("help");
        expect(envelope.data.usage).toContain("Usage: pptx settings list|get|set INPUT");
        expect(envelope.data.usage).toContain("--notes-width");
        expect(envelope.data.usage).toContain("Print and view properties");
        expect(readInput).not.toHaveBeenCalled();
        expect(publishOutput).not.toHaveBeenCalled();
      }
    }
  );
  it("scales drawing geometry only with an explicit true value", async () => {
    const f = await fixture();
    const changed = await f.run([
      "settings",
      "set",
      "/deck.pptx",
      "--width",
      "24384000emu",
      "--height",
      "13716000emu",
      "--scale-content",
      "true",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    const bytes = new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer);
    expect(bytes).toEqual(
      await mutatePresentationSettings(
        await original!,
        { width: 24384000, height: 13716000, scaleContent: true },
        context
      )
    );
    const xml = new TextDecoder().decode(
      inspectZip(bytes).find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload
    );
    expect(xml).toContain('x="200"');
    expect(xml).toContain('y="400"');
    expect(xml).toContain('cx="600"');
    expect(xml).toContain('cy="800"');
  });
  it("accepts zero notes dimensions through CLI and public SDK", async () => {
    const f = await fixture();
    const changed = await f.run([
      "settings",
      "set",
      "/deck.pptx",
      "--notes-width",
      "0emu",
      "--notes-height",
      "0in",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    const bytes = new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer);
    expect(bytes).toEqual(
      await mutatePresentationSettings(await original!, { notesWidth: 0, notesHeight: 0 }, context)
    );
    const read = await f.run(["settings", "get", "/deck.pptx"]);
    expect(read.envelope.data.settings).toMatchObject({ notesWidth: 0, notesHeight: 0 });
    const schema = await f.run(["schema", "settings", "get"]);
    expect(
      compileJsonSchema(schema.envelope.data.operations["settings.get"].result).validate(
        read.envelope
      ).ok
    ).toBe(true);
  });
  it("reads singleton settings and edits canvas, notes, numbering and show options", async () => {
    const f = await fixture();
    const before = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const read = await f.run(["settings", "get", "/deck.pptx"]);
    expect(read.exitCode).toBe(0);
    expect(read.envelope.data.settings).toMatchObject({
      width: 12192000,
      height: 6858000,
      orientation: "landscape",
      slideNumberStart: 1
    });
    const changed = await f.run([
      "settings",
      "set",
      "/deck.pptx",
      "--width",
      "10in",
      "--height",
      "5in",
      "--scale-content",
      "false",
      "--notes-width",
      "6in",
      "--notes-height",
      "9in",
      "--slide-number-start",
      "7",
      "--loop",
      "true",
      "--show-type",
      "kiosk",
      "--in-place"
    ]);
    expect(changed.exitCode, JSON.stringify(changed.envelope)).toBe(0);
    expect(changed.envelope).toMatchObject({ operation: "settings.set", affected: 1 });
    const sdk = await mutatePresentationSettings(
      await original!,
      {
        width: 9144000,
        height: 4572000,
        notesWidth: 5486400,
        notesHeight: 8229600,
        slideNumberStart: 7,
        loop: true,
        showType: "kiosk"
      },
      context
    );
    expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(sdk);
    expect(await readPresentationSettings(sdk, context)).toMatchObject({
      slideNumberStart: 7,
      showType: "kiosk"
    });
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const xml = new TextDecoder().decode(
      entries.find((entry) => entry.name === "ppt/presentation.xml")!.payload
    );
    expect(xml).toContain('cx="9144000"');
    expect(xml).toContain('cy="4572000"');
    expect(xml).toContain('firstSlideNum="7"');
    expect(entries.find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload).toEqual(
      before.find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload
    );
    const listed = await f.run(["settings", "list", "/deck.pptx"]);
    expect(listed.envelope.data.records).toMatchObject([
      { width: 9144000, notesWidth: 5486400, notesHeight: 8229600, loop: true, showType: "kiosk" }
    ]);
  });

  it.each([
    ["--scale-content"],
    ["--width", "10in", "--scale-content"],
    ["--scale-content", "yes"],
    ["--scale-content", "false"],
    ["--scale-content", "true", "--loop", "true"],
    ["--loop", "yes"],
    ["--show-type", "other"],
    ["--slide-number-start", "1.5"],
    ["--slide-number-start", "2147483648"],
    ["--slide-number-start", "-2147483649"],
    ["--notes-orientation", "sideways"],
    ["--width", "1"],
    ["--width", "10in", "--width", "11in"],
    ["--width", "10in", "--slide", "1"],
    []
  ])("rejects invalid or unsupported mutations without publication: %j", async (...flags) => {
    const f = await fixture();
    const before = f.volume.readFileSync("/deck.pptx");
    const result = await f.run(["settings", "set", "/deck.pptx", ...flags, "--in-place"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.envelope.affected).toBe(0);
    expect(f.publishOutput).not.toHaveBeenCalled();
    expect(f.volume.readFileSync("/deck.pptx")).toEqual(before);
  });

  it.each([
    ["get", "--output", "/copy.pptx"],
    ["get", "--scope", "presentation"],
    ["set", "--width", "10in"],
    ["set", "--width", "10in", "--in-place", "--output", "/copy.pptx"],
    ["set", "--width", "10in", "--output", "-"],
    ["set", "--width", "10in", "--output", "/deck.pptx"],
    ["set", "--width", "10in", "--force", "--dry-run"]
  ])("rejects inapplicable settings options before reading: %j", async (action, ...flags) => {
    const f = await fixture();
    const result = await f.run(["settings", action, "/deck.pptx", ...flags]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });

  it("validates dry runs and publishes matching operation schemas", async () => {
    const f = await fixture();
    const dry = await f.run([
      "settings",
      "set",
      "/deck.pptx",
      "--orientation",
      "portrait",
      "--dry-run"
    ]);
    expect(dry.exitCode).toBe(0);
    expect(dry.envelope.data).toMatchObject({ outputs: [], fingerprint: null });
    expect(f.publishOutput).not.toHaveBeenCalled();
    for (const action of ["list", "get", "set"]) {
      const schema = await f.run(["schema", "settings", action]);
      expect(schema.exitCode).toBe(0);
      const declaration = schema.envelope.data.operations[`settings.${action}`];
      if (action === "set") {
        const options = compileJsonSchema(declaration.options);
        expect(options.validate({ scaleContent: false, dryRun: true }).ok).toBe(false);
        expect(options.validate({ scaleContent: true, loop: true, dryRun: true }).ok).toBe(false);
        expect(
          options.validate({ width: { value: 10, unit: "in" }, scaleContent: true, dryRun: true })
            .ok
        ).toBe(true);
      }
      const result = action === "set" ? dry : await f.run(["settings", action, "/deck.pptx"]);
      expect(compileJsonSchema(declaration.result).validate(result.envelope).ok).toBe(true);
    }
    const capabilities = await f.run(["capabilities"]);
    expect(capabilities.envelope.data.features.settings.level).toBe("edit");
  });
});
