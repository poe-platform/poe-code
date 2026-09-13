import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 48 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) => delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function fixture() {
  const volume = Volume.fromJSON({});
  const bytes = await createPresentation({ slides: [{ shapes: [{ name: "Badge", text: "Badge", x: 0, y: 0, width: 100, height: 100 }] }] }, context);
  volume.writeFileSync("/deck", bytes);
  const readInput = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(async (p: PptxPublicationRequest) => { if (!p.dryRun) volume.writeFileSync(p.outputPath, p.bytes); });
  const engine = createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 262144 });
  const run = async (args: string[]) => {
    const output = await engine.execute({ args: args.map(v => new TextEncoder().encode(v)), signal: new AbortController().signal, readInput, publishOutput });
    return { ...output, text: new TextDecoder().decode(output.stdout) };
  };
  return { volume, bytes, readInput, publishOutput, run };
}
const target = JSON.stringify({ slide: 1, shape: "Badge" });
it.each(["appear", "fade-in", "fade-out", "pulse"])("authors %s with valid shape targets and closed mutation results", async kind => {
  const f = await fixture();
  const out = await f.run(["animations", "add", "/deck", "--kind", kind, "--trigger", "on-click", "--target", target, "--output", "/out", "--json"]);
  expect(out.exitCode, out.text).toBe(0);
  const envelope = JSON.parse(out.text);
  expect(envelope.affected).toBe(1);
  const schema = JSON.parse((await f.run(["schema", "animations", "add", "--json"])).text).data.operations["animations.add"];
  expect(compileJsonSchema(schema.result).validate(envelope).ok).toBe(true);
  const payload = inspectZip(new Uint8Array(f.volume.readFileSync("/out") as Buffer)).find(p => p.name === "ppt/slides/slide1.xml")!.payload;
  const document = parseXmlPart(payload, context.xmlLimits);
  const flatten = (node: XmlElement): XmlElement[] => [node, ...node.children.flatMap(flatten)];
  const elements = flatten(document.root);
  const ids = elements.filter(e => e.name.localName === "cTn").map(e => e.attributes.find(a => a.name.localName === "id")?.value);
  expect(ids.length).toBeGreaterThan(1);
  expect(new Set(ids).size).toBe(ids.length);
  expect(elements.filter(e => e.name.localName === "spTgt").map(e => e.attributes.find(a => a.name.localName === "spid")?.value)).toEqual(expect.arrayContaining(["2"]));
  const set = await f.run(["animations", "set", "/out", "--slide", "1", "--shape", "Badge", "--delay", "17", "--in-place", "--json"]);
  expect(set.exitCode, set.text).toBe(0);
  const remove = await f.run(["animations", "remove", "/out", "--slide", "1", "--shape", "Badge", "--in-place", "--json"]);
  expect(remove.exitCode, remove.text).toBe(0);
});
it("rejects malformed edits before reading and dependent triggers before publication", async () => {
  const f = await fixture();
  for (const flags of [["--duration", "1s"], ["--trigger", "hover"], ["--delay", "2147483648"]]) {
    const out = await f.run(["animations", "add", "/deck", "--kind", "fade-in", "--target", target, "--output", "/out", ...flags, "--json"]);
    expect(out.exitCode, out.text).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
  const out = await f.run(["animations", "add", "/deck", "--kind", "fade-in", "--trigger", "after-previous", "--target", target, "--output", "/out", "--json"]);
  expect(out.exitCode).toBe(2);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(f.volume.existsSync("/out")).toBe(false);
});
it("advertises required edit fields and validates dry-run without publishing bytes", async () => {
  const f = await fixture();
  const descriptor = JSON.parse((await f.run(["schema", "animations", "add", "--json"])).text).data.operations["animations.add"];
  const schema = compileJsonSchema(descriptor.options);
  const options = { kind: "pulse", trigger: "on-click", target: JSON.parse(target), dryRun: true };
  expect(schema.validate(options).ok).toBe(true);
  for (const key of ["kind", "trigger", "target"]) {
    const incomplete = { ...options } as Record<string, unknown>;
    delete incomplete[key];
    expect(schema.validate(incomplete).ok).toBe(false);
  }
  expect(schema.validate({ ...options, duration: 0.5 }).ok).toBe(false);
  expect(schema.validate({ ...options, unknown: true }).ok).toBe(false);
  const out = await f.run(["animations", "add", "/deck", "--kind", "pulse", "--trigger", "on-click", "--target", target, "--dry-run", "--json"]);
  expect(out.exitCode, out.text).toBe(0);
  expect(JSON.parse(out.text).data.outputs).toEqual([]);
  expect(JSON.parse(out.text).data.fingerprint).toBeNull();
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(new Uint8Array(f.volume.readFileSync("/deck") as Buffer)).toEqual(f.bytes);
});
it("permits an explicitly empty batch selection on a missing owning slide", async () => {
  const f = await fixture();
  const ops = { version: 1, operations: [{ operation: "animations.remove", arguments: {}, options: { slide: 7, shape: "Absent", allowEmpty: true } }] };
  const out = await f.run(["batch", "/deck", "--ops-json", JSON.stringify(ops), "--output", "/out", "--json"]);
  expect(out.exitCode, out.text).toBe(0);
  expect(JSON.parse(out.text).affected).toBe(0);
  expect(f.publishOutput).not.toHaveBeenCalled();
});
it("batches dependent trigger retargeting and removal with one publication", async () => {
  const f = await fixture();
  const shape = (name: string) => ({ name, text: name, x: 0, y: 0, width: 100, height: 100 });
  f.volume.writeFileSync("/deck", await createPresentation({ slides: [{ shapes: [shape("First"), shape("Second")] }] }, context));
  const ops = { version: 1, operations: [
    { operation: "animations.add", arguments: { kind: "fade-in", trigger: "on-click", target: { slide: 1, shape: "First" } } },
    { operation: "animations.add", arguments: { kind: "pulse", trigger: "after-previous", target: { slide: 1, shape: "Second" } } },
    { operation: "animations.set", arguments: { trigger: "on-click" }, options: { slide: 1, shape: "Second" } },
    { operation: "animations.remove", arguments: {}, options: { slide: 1, shape: "First" } }
  ] };
  const out = await f.run(["batch", "/deck", "--ops-json", JSON.stringify(ops), "--output", "/out", "--json"]);
  expect(out.exitCode, out.text).toBe(0);
  expect(f.publishOutput).toHaveBeenCalledTimes(1);
  const result = JSON.parse(out.text);
  expect(result.affected).toBe(4);
  expect(result.data.results.map((entry: { operation: string }) => entry.operation)).toEqual(["animations.add", "animations.add", "animations.set", "animations.remove"]);
  expect(result.data.outputs).toHaveLength(1);
  const descriptor = JSON.parse((await f.run(["schema", "batch", "--json"])).text).data.operations.batch;
  expect(compileJsonSchema(descriptor.result).validate(result).ok).toBe(true);
  const graph = JSON.parse((await f.run(["animations", "list", "/out", "--json"])).text).data.items;
  const targets = graph.flatMap((item: { fields: { name: string; value: { value: unknown } }[] }) => item.fields.filter(field => field.name === "targetShapeId" && field.value.value !== null).map(field => field.value.value));
  expect(new Set(targets)).toEqual(new Set(["3"]));
});
it("validates the complete batch before acquisition and does not publish a failed later operation", async () => {
  const f = await fixture();
  const add = { operation: "animations.add", arguments: { kind: "fade-in", trigger: "on-click", target: { slide: 1, shape: "Badge" } } };
  const badSyntax = { version: 1, operations: [add, { operation: "unknown", arguments: {} }] };
  const invalid = await f.run(["batch", "/deck", "--ops-json", JSON.stringify(badSyntax), "--output", "/out", "--json"]);
  expect(invalid.exitCode).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
  f.volume.writeFileSync("/ops", JSON.stringify({ version: 1, operations: [add, { operation: "animations.remove", arguments: {}, options: { slide: 1, shape: "Missing" } }] }));
  const failed = await f.run(["batch", "/deck", "--ops-file", "/ops", "--output", "/out", "--json"]);
  expect(failed.exitCode, failed.text).toBe(1);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(f.volume.existsSync("/out")).toBe(false);
  expect(new Uint8Array(f.volume.readFileSync("/deck") as Buffer)).toEqual(f.bytes);
});
it("accepts an empty batch without a destination and validates nonempty dry-runs", async () => {
  const f = await fixture();
  const empty = await f.run(["batch", "/deck", "--ops-json", '{"version":1,"operations":[]}', "--json"]);
  expect(empty.exitCode, empty.text).toBe(0);
  expect(JSON.parse(empty.text).data).toEqual({ results: [], outputs: [] });
  expect(JSON.parse(empty.text).affected).toBe(0);
  const ops = { version: 1, operations: [{ operation: "animations.add", arguments: { kind: "pulse", trigger: "on-click", target: { slide: 1, shape: "Badge" } } }] };
  const dry = await f.run(["batch", "/deck", "--ops-json", JSON.stringify(ops), "--dry-run", "--json"]);
  expect(dry.exitCode, dry.text).toBe(0);
  expect(JSON.parse(dry.text).data.outputs).toEqual([]);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(new Uint8Array(f.volume.readFileSync("/deck") as Buffer)).toEqual(f.bytes);
});
