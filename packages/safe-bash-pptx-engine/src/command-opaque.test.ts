import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { opaqueContext, opaqueDeck } from "../tests/fixtures/opaque-deck.js";

const engine = createPptxCommandEngine({ context: opaqueContext, maxOutputBytes: 131072, maxArgumentBytes: 8192 });
function invocation(args: string[]) {
  const fixture = opaqueDeck();
  const volume = Volume.fromJSON({ "/out": null, "/deck.pptx": Buffer.from(fixture.bytes) });
  const publications: PptxPublicationRequest[] = [];
  return { fixture, volume, publications, args: args.map(value => new TextEncoder().encode(value)), signal: new AbortController().signal,
    async readInput(path: string) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
    async publishOutput(item: PptxPublicationRequest) { if (!item.dryRun) { publications.push(item); volume.writeFileSync(item.outputPath, item.bytes); } }
  };
}
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
it("lists opaque object activity and font resources through the command SDK", async () => {
  const result = await engine.execute(invocation(["objects", "list", "/deck.pptx", "--json"]));
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.operation).toBe("objects.list");
  expect(envelope.affected).toBe(0);
  expect(envelope.data.activationPerformed).toBe(false);
  expect(envelope.data.recursiveParsingPerformed).toBe(false);
  expect(envelope.data.objects.find((item: { part: string }) => item.part === "/ppt/embeddings/capsule.bin")).toMatchObject({ activeContent: true, bytes: 11 });
  const fonts = await engine.execute(invocation(["fonts", "list", "/deck.pptx", "--json"]));
  expect(fonts.exitCode, decode(fonts.stdout)).toBe(0);
  expect(JSON.parse(decode(fonts.stdout)).data.fonts).toHaveLength(1);
});
it("extracts an exact opaque relationship closure with safe deterministic names", async () => {
  const request = invocation(["objects", "extract", "/deck.pptx", "--part", "/ppt/embeddings/capsule.bin", "--output-dir", "/out", "--allow-partial-output", "--json"]);
  const result = await engine.execute(request);
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.operation).toBe("objects.extract");
  expect(envelope.data.outputs.map((item: { part: string }) => item.part).sort()).toEqual(["/ppt/embeddings/_rels/capsule.bin.rels", "/ppt/embeddings/capsule.bin", "/ppt/media/preview.bin"]);
  for (const output of envelope.data.outputs) {
    const expected = request.fixture.members.find(item => `/${item.name}` === output.part)!.bytes;
    expect(new Uint8Array(request.volume.readFileSync(output.path) as Buffer)).toEqual(expected);
    expect(output.name).toBe(`opaque-${createHash("sha256").update(output.part).digest("hex")}.bin`);
    expect(output.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
  }
  expect(new Uint8Array(request.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(request.fixture.bytes);
});
it("requires explicit partial publication and rejects irrelevant selectors and unsafe parts", async () => {
  const request = invocation(["objects", "extract", "/deck.pptx", "--part", "/ppt/embeddings/capsule.bin", "--output-dir", "/out", "--json"]);
  const result = await engine.execute(request);
  expect(result.exitCode).toBe(3);
  expect(request.publications).toHaveLength(0);
  for (const flags of [["--slide", "1"], ["--part", "../capsule.bin"]]) {
    const invalid = invocation(["objects", "list", "/deck.pptx", "--json", ...flags]);
    expect((await engine.execute(invalid)).exitCode).toBe(2);
  }
});
it("reports only completed files after an explicitly partial publication failure", async () => {
  const request = invocation(["objects", "extract", "/deck.pptx", "--part", "/ppt/embeddings/capsule.bin", "--output-dir", "/out", "--allow-partial-output", "--json"]);
  const publish = request.publishOutput;
  request.publishOutput = async item => {
    if (!item.dryRun && request.publications.length === 1) throw new Error("Destination is unavailable.");
    await publish(item);
  };
  const result = await engine.execute(request);
  expect(result.exitCode).toBe(3);
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.ok).toBe(false);
  expect(envelope.data.outputs).toHaveLength(1);
  expect(envelope.data.outputs[0].path).toBe(request.publications[0]!.outputPath);
  expect(request.volume.readdirSync("/out")).toHaveLength(1);
});
it("admits complete manifest output budgets before publishing any file", async () => {
  const limited = createPptxCommandEngine({ context: opaqueContext, maxOutputBytes: 512, maxArgumentBytes: 8192 });
  const request = invocation(["objects", "extract", "/deck.pptx", "--part", "/ppt/embeddings/capsule.bin", "--output-dir", "/out", "--allow-partial-output", "--json"]);
  expect((await limited.execute(request)).exitCode).toBe(4);
  expect(request.publications).toHaveLength(0);
});
it("enforces an explicit output count ceiling before extraction publication", async () => {
  const request = invocation(["objects", "extract", "/deck.pptx", "--part", "/ppt/embeddings/capsule.bin", "--output-dir", "/out", "--allow-partial-output", "--limit", "maxOutputs=1", "--json"]);
  expect((await engine.execute(request)).exitCode).toBe(4);
  expect(request.publications).toHaveLength(0);
});
it("publishes schemas that validate object and font inventory envelopes", async () => {
  for (const resource of ["objects", "fonts"]) {
    const schemaResult = await engine.execute(invocation(["schema", resource, "list", "--json"]));
    expect(schemaResult.exitCode, decode(schemaResult.stdout)).toBe(0);
    const schema = JSON.parse(decode(schemaResult.stdout)).data.operations[`${resource}.list`].result;
    const result = await engine.execute(invocation([resource, "list", "/deck.pptx", "--json"]));
    expect(compileJsonSchema(schema).validate(JSON.parse(decode(result.stdout))).ok).toBe(true);
  }
});
