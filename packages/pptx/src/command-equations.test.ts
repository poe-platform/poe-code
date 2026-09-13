import { Volume } from "memfs";
import { beforeAll, afterAll, vi, it, expect } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation, mutateEquations, readShapes, createPptxCommandEngine, type PptxPublicationRequest } from "./index.js";

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
const math = '<q:oMath xmlns:q="http://schemas.openxmlformats.org/officeDocument/2006/math"><q:r><q:t>λ + 4</q:t></q:r></q:oMath>';
async function fixture() {
  const volume = Volume.fromJSON({ "/formula.xml": math });
  const input = await createPresentation({ slides: [{ shapes: [{ name: "Formula", x: 0, y: 0, width: 100, height: 100, text: "Before" }] }] }, context);
  volume.writeFileSync("/deck.pptx", input);
  const readInput = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(async (p: PptxPublicationRequest) => { if (!p.dryRun) volume.writeFileSync(p.outputPath, p.bytes); });
  const engine = createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 65536 });
  const run = async (args: string[]) => {
    const result = await engine.execute({ args: args.map(x => new TextEncoder().encode(x)), signal: new AbortController().signal, readInput, publishOutput });
    return { ...result, text: new TextDecoder().decode(result.stdout), error: new TextDecoder().decode(result.stderr) };
  };
  return { volume, input, run, readInput, publishOutput };
}
it("inserts caller-authored math and inventories original Unicode content", async () => {
  const f = await fixture();
  const add = await f.run(["equations", "add", "/deck.pptx", "--slide", "1", "--shape", "Formula", "--file", "/formula.xml", "--output", "/out.pptx", "--json"]);
  expect(add.exitCode, add.text + add.error).toBe(0);
  expect(JSON.parse(add.text)).toMatchObject({ operation: "equations.add", affected: 1 });
  expect(f.publishOutput.mock.calls[0]![0].protectedInputPaths).toEqual(["/formula.xml"]);
  const list = await f.run(["equations", "get", "/out.pptx", "--slide", "1", "--shape", "Formula", "--json"]);
  expect(list.exitCode, list.text + list.error).toBe(0);
  expect(JSON.parse(list.text).data.equations).toMatchObject([{ text: "λ + 4", supported: true, coordinateSystem: "zero-based", paragraph: 0, equation: 0 }]);
  const schema = await f.run(["schema", "equations", "get", "--json"]);
  const descriptor = JSON.parse(schema.text).data.operations["equations.get"];
  expect(compileJsonSchema(descriptor.result).validate(JSON.parse(list.text)).ok).toBe(true);
});
it("rejects missing inputs and incompatible options before reading", async () => {
  const f = await fixture();
  for (const argv of [
    ["add", "/deck.pptx", "--shape", "Formula", "--dry-run"],
    ["list", "/deck.pptx", "--file", "/formula.xml"],
    ["add", "/deck.pptx", "--shape", "Formula", "--file", "/formula.xml", "--in-place", "--output", "/out.pptx"],
    ["list", "/deck.pptx", "--scope", "notes"],
    ["add", "-", "--shape", "Formula", "--file", "-", "--dry-run"]
  ]) expect((await f.run(["equations", ...argv, "--json"])).exitCode).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
  expect(f.publishOutput).not.toHaveBeenCalled();
});
it("validates dry runs and refuses malformed authored XML without publication", async () => {
  const f = await fixture();
  const argv = ["equations", "add", "/deck.pptx", "--slide", "1", "--shape", "Formula", "--file", "/formula.xml", "--dry-run", "--json"];
  const valid = await f.run(argv);
  expect(valid.exitCode, valid.text).toBe(0);
  expect(JSON.parse(valid.text)).toMatchObject({ affected: 1, data: { dryRun: true } });
  expect(f.publishOutput).not.toHaveBeenCalled();
  f.volume.writeFileSync("/formula.xml", '<oMath><r>broken');
  const invalid = await f.run(argv);
  expect(invalid.exitCode).not.toBe(0);
  expect(JSON.parse(invalid.text).affected).toBe(0);
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.input);
});
it.each([
  '<oMath><r><t>x</t></r></oMath>',
  '<m:oMath xmlns:m="urn:wrong"><m:r><m:t>x</m:t></m:r></m:oMath>',
  '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t><m:extension/></m:r></m:oMath>',
  '<!DOCTYPE x [<!ENTITY payload "x">]><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>&payload;</m:t></m:r></m:oMath>'
])("rejects unadmitted authored math in both SDK and CLI: %s", async xml => {
  const f = await fixture();
  f.volume.writeFileSync("/formula.xml", xml);
  await expect(mutateEquations(f.input, "add", { select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } }, shape: "Formula", file: new TextEncoder().encode(xml) }, context)).rejects.toThrow();
  const result = await f.run(["equations", "add", "/deck.pptx", "--slide", "1", "--shape", "Formula", "--file", "/formula.xml", "--output", "/out.pptx", "--json"]);
  expect(result.exitCode).not.toBe(0);
  expect(JSON.parse(result.text).affected).toBe(0);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(f.volume.existsSync("/out.pptx")).toBe(false);
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.input);
});
it("reports empty lists, missing singular reads and explicit capability boundaries", async () => {
  const f = await fixture();
  const list = await f.run(["equations", "list", "/deck.pptx", "--json"]);
  expect(JSON.parse(list.text)).toMatchObject({ ok: true, data: { equations: [] } });
  const get = await f.run(["equations", "get", "/deck.pptx", "--json"]);
  expect(get.exitCode).toBe(1);
  const capabilities = await f.run(["capabilities", "--json"]);
  expect(JSON.parse(capabilities.text).data.features.equations.operations).toEqual(["equations.list", "equations.get", "equations.add"]);
  const help = await f.run(["equations", "add", "--help"]);
  expect(help.text).toContain("No rendering, evaluation, set or remove");
});
it("shape tokens select bounded inventories and singular reads reject multiple equations", async () => {
  const f = await fixture();
  const token = (await readShapes(f.input, {}, context))[0]!.token;
  const first = await f.run(["equations", "add", "/deck.pptx", "--select", token, "--file", "/formula.xml", "--output", "/one.pptx", "--json"]);
  expect(first.exitCode, first.text).toBe(0);
  const second = await f.run(["equations", "add", "/one.pptx", "--slide", "1", "--shape", "Formula", "--file", "/formula.xml", "--output", "/two.pptx", "--json"]);
  expect(second.exitCode, second.text).toBe(0);
  const bytes = new Uint8Array(f.volume.readFileSync("/two.pptx") as Buffer);
  const current = (await readShapes(bytes, {}, context))[0]!.token;
  const list = await f.run(["equations", "list", "/two.pptx", "--select", current, "--json"]);
  expect(JSON.parse(list.text).data.equations.map((value: { equation: number }) => value.equation)).toEqual([0, 1]);
  const singular = await f.run(["equations", "get", "/two.pptx", "--select", current, "--json"]);
  expect(singular.exitCode).toBe(1);
  expect(JSON.parse(singular.text).errors[0].code).toBe("ambiguous-selection");
  const stale = await f.run(["equations", "list", "/two.pptx", "--select", token, "--json"]);
  expect(stale.exitCode).not.toBe(0);
});
it("schema and argument admission agree about insertion selectors and publication", async () => {
  const f = await fixture();
  const result = await f.run(["schema", "equations", "add", "--json"]);
  const schema = compileJsonSchema(JSON.parse(result.text).data.operations["equations.add"].options);
  const valid = { slide: 1, shape: "Formula", file: "/formula.xml", dryRun: true };
  expect(schema.validate(valid).ok).toBe(true);
  for (const invalid of [
    { file: "/formula.xml", dryRun: true },
    { file: "/formula.xml", shape: "Formula", dryRun: true },
    { ...valid, all: true }, { ...valid, scope: "notes" },
    { ...valid, inPlace: true, output: "/out.pptx" }, { ...valid, force: true }
  ]) expect(schema.validate(invalid).ok).toBe(false);
  for (const flags of [["--limit", "maxBytes=999999"], ["--limit", "maxNodes=20", "--limit", "maxNodes=20"], ["--json", "--json"]]) {
    const rejected = await f.run(["equations", "list", "/deck.pptx", ...flags]);
    expect(rejected.exitCode).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
});
