import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";
import { readAnimations } from "./animations.js";
import { readSelectionIndex } from "./selectors.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 8192, maxTotalBytes: 32768, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 8192, chunkSize: 512 },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
async function fixture() {
  const volume = Volume.fromJSON({});
  const bytes = await createPresentation({ slides: [{}, {}] }, context);
  volume.writeFileSync("/deck.pptx", bytes);
  const readInput = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const engine = createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 65536 });
  const run = async (args: string[]) => {
    const output = await engine.execute({ args: args.map(x => new TextEncoder().encode(x)), signal: new AbortController().signal, readInput });
    return { ...output, text: new TextDecoder().decode(output.stdout) };
  };
  return { run, readInput, volume, bytes };
}
it("discovers bounded read-only animation inventories and validates empty results", async () => {
  const f = await fixture();
  const out = await f.run(["animations", "list", "/deck.pptx", "--json"]);
  expect(out.exitCode, out.text).toBe(0);
  expect(JSON.parse(out.text).data).toEqual({ items: [] });
  const descriptor = JSON.parse((await f.run(["schema", "animations", "list", "--json"])).text).data.operations["animations.list"];
  expect(compileJsonSchema(descriptor.result).validate(JSON.parse(out.text)).ok).toBe(true);
  expect(JSON.parse((await f.run(["capabilities", "--json"])).text).data).toHaveProperty("features.animations.operations", ["animations.list", "animations.get"]);
  expect((await f.run(["animations", "get", "/deck.pptx", "--json"])).exitCode).toBe(1);
  expect((await f.run(["animations", "get", "/deck.pptx", "--slide", "1", "--json"])).exitCode).toBe(0);
  expect((await f.run(["animations", "list", "/deck.pptx", "--limit", "maxNodes=1", "--json"])).exitCode).toBe(4);
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.bytes);
});
it("rejects invalid animation selectors and mutation flags before acquisition", async () => {
  const f = await fixture();
  for (const flags of [["--scope", "notes"], ["--shape", "Box"], ["--all"], ["--output", "/out"], ["--select", "token", "--slide", "1"]]) {
    expect((await f.run(["animations", "list", "/deck.pptx", ...flags, "--json"])).exitCode).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
});
it("exposes ordered nested graph fields with closed schema and SDK parity", async () => {
  const f = await fixture();
  const parts = inspectZip(f.bytes).map(({ name, payload }) => {
    if (name !== "ppt/slides/slide1.xml") return { name, bytes: payload };
    const doc = parseXmlPart(payload, context.xmlLimits);
    return { name, bytes: doc.spliceChildren(doc.root, doc.root.children.length, 0, ['<p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:tnLst><p:seq><p:cTn id="4"><p:childTnLst><p:par><p:animMotion path="M 0 0 L 1 1 E"><p:cBhvr><p:cTn id="5"/><p:tgtEl><p:spTgt spid="42"/></p:tgtEl></p:cBhvr></p:animMotion></p:par></p:childTnLst></p:cTn></p:seq></p:tnLst></p:timing>']).bytes() };
  });
  const bytes = await writePackageArchive(parts, context, { compression: "store" });
  f.volume.writeFileSync("/deck.pptx", bytes);
  const out = await f.run(["animations", "get", "/deck.pptx", "--slide", "1", "--json"]);
  expect(out.exitCode, out.text).toBe(0);
  const envelope = JSON.parse(out.text);
  const items = envelope.data.items;
  expect(items.map((item: { name: string }) => item.name)).toEqual(["timing", "tnLst", "seq", "cTn", "childTnLst", "par", "animMotion", "cBhvr", "cTn", "tgtEl", "spTgt"]);
  const fields = (index: number) => Object.fromEntries(items[index].fields.map((field: { name: string; value: { value: unknown } }) => [field.name, field.value.value]));
  expect(fields(6).motionPath).toBe("M 0 0 L 1 1 E");
  expect(fields(10).targetShapeId).toBe("42");
  expect(fields(2).children).toEqual([{ type: "string", value: fields(3).id }]);
  expect(fields(3).parentId).toBe(fields(2).id);
  const records = await readAnimations(bytes, { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } } }, context);
  expect(items.map((_: unknown, index: number) => fields(index).id)).toEqual(records[0]!.nodes.map(node => node.id));
  const descriptor = JSON.parse((await f.run(["schema", "animations", "get", "--json"])).text).data.operations["animations.get"];
  const schema = compileJsonSchema(descriptor.result);
  expect(schema.validate(envelope).ok).toBe(true);
  items[0].fields[0].name = "undeclared";
  expect(schema.validate(envelope).ok).toBe(false);
});
it("rejects stale tokens and ambiguous shape names while accepting an untargeted unique shape", async () => {
  const f = await fixture();
  const index = await readSelectionIndex(f.bytes, context);
  const shape = { x: 0, y: 0, width: 10, height: 10, text: "" };
  f.volume.writeFileSync("/deck.pptx", await createPresentation({ slides: [{ shapes: [{ ...shape, name: "Box" }, { ...shape, name: "Box" }, { ...shape, name: "Single" }] }] }, context));
  const stale = await f.run(["animations", "list", "/deck.pptx", "--select", index.slides[0]!.token, "--json"]);
  expect(stale.exitCode).toBe(1);
  expect(JSON.parse(stale.text).errors[0].code).toBe("stale-selection");
  const ambiguous = await f.run(["animations", "list", "/deck.pptx", "--slide", "1", "--shape", "Box", "--json"]);
  expect(ambiguous.exitCode).toBe(1);
  expect(JSON.parse(ambiguous.text).errors[0].code).toBe("ambiguous-selection");
  const unique = await f.run(["animations", "list", "/deck.pptx", "--slide", "1", "--shape", "Single", "--json"]);
  expect(unique.exitCode, unique.text).toBe(0);
  expect(JSON.parse(unique.text).data).toEqual({ items: [] });
});
