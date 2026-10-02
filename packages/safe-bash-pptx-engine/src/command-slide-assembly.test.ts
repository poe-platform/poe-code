import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";

const context = {
  limits: { maxBytes: 1048576, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1048576,
    maxEntryBytes: 65536,
    maxTotalBytes: 1048576,
    maxMembers: 256,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 1048576, maxNodes: 20000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 1048576, maxParts: 4096, maxRelationships: 4096 }
};
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 1048576
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
let deck: Uint8Array;
beforeAll(async () => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  deck = await createPresentation({ slides: [{ name: "Dawn" }, { name: "Dusk" }] }, context);
});
afterAll(() => vi.restoreAllMocks());
function invocation(flags: string[]) {
  const volume = Volume.fromJSON({ "/out/.keep": "" });
  for (const path of ["/input.pptx", "/a.pptx", "/b.pptx"]) volume.writeFileSync(path, deck);
  return {
    volume,
    args: flags.map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)),
    preflightOutput: vi.fn(async (_item: PptxPublicationRequest) => {}),
    publishOutput: vi.fn(async (item: PptxPublicationRequest) => {
      if (!item.dryRun) volume.writeFileSync(item.outputPath, item.bytes);
    })
  };
}
const merge = [
  "slides",
  "merge",
  "/input.pptx",
  "--sources",
  '[{"vfsPath":"/a.pptx"},{"vfsPath":"/b.pptx"}]',
  "--source-slides",
  "[2,1]",
  "--theme-policy",
  "source"
];
const split = ["slides", "split", "/input.pptx", "--slides", "[2,1]", "--output-dir", "/out"];

it("merges sources in requested order with protected input paths", async () => {
  const request = invocation([...merge, "--output", "/merged.pptx", "--json"]);
  const response = await engine.execute(request);
  expect(response.exitCode, decode(response.stdout)).toBe(0);
  expect(JSON.parse(decode(response.stdout))).toMatchObject({
    operation: "slides.merge",
    affected: 4
  });
  expect(request.publishOutput.mock.calls[0]![0].protectedInputPaths).toEqual([
    "/a.pptx",
    "/b.pptx"
  ]);
  const slides = inspectZip(
    new Uint8Array(request.volume.readFileSync("/merged.pptx") as Buffer)
  ).filter((entry) => entry.name.startsWith("ppt/slides/") && entry.name.endsWith(".xml"));
  expect(slides).toHaveLength(6);
  expect(request.volume.readFileSync("/a.pptx")).toEqual(Buffer.from(deck));
});

it("owns each admitted input before a provider reuses its byte buffer", async () => {
  const source = await createPresentation(
    { slides: [{ name: "West" }, { name: "East" }] },
    context
  );
  expect(source.length).toBe(deck.length);
  const buffer = new Uint8Array(deck.length);
  const request = invocation([
    "slides",
    "merge",
    "/input.pptx",
    "--sources",
    '[{"vfsPath":"/a.pptx"}]',
    "--theme-policy",
    "source",
    "--output",
    "/merged.pptx",
    "--json"
  ]);
  request.readInput.mockImplementation(async (path) => {
    buffer.set(path === "/input.pptx" ? deck : source);
    return buffer;
  });
  const response = await engine.execute(request);
  expect(response.exitCode, decode(response.stdout)).toBe(0);
  const slides = inspectZip(
    new Uint8Array(request.volume.readFileSync("/merged.pptx") as Buffer)
  ).filter((entry) => entry.name.startsWith("ppt/slides/") && entry.name.endsWith(".xml"));
  const xml = slides.map((entry) => decode(entry.payload)).join("\n");
  for (const name of ["Dawn", "Dusk", "West", "East"]) expect(xml).toContain(`name="${name}"`);
});

it("splits independent packages with deterministic source manifests", async () => {
  const request = invocation([...split, "--allow-partial-output", "--json"]);
  const response = await engine.execute(request);
  expect(response.exitCode, decode(response.stdout)).toBe(0);
  const result = JSON.parse(decode(response.stdout));
  expect(result).toMatchObject({
    operation: "slides.split",
    affected: 2,
    data: {
      outputs: [{ path: "/out/slide-000001.pptx" }, { path: "/out/slide-000002.pptx" }],
      sources: [{ sourceSlide: 2 }, { sourceSlide: 1 }]
    }
  });
  expect(
    result.data.sources.map(
      (item: { sourceLocation: { owner: string; objectId: string } }) => item.sourceLocation
    )
  ).toMatchObject([
    { owner: "/ppt/presentation.xml", objectId: "257" },
    { owner: "/ppt/presentation.xml", objectId: "256" }
  ]);
  for (const [index, name] of ["Dusk", "Dawn"].entries()) {
    const entries = inspectZip(
      new Uint8Array(request.volume.readFileSync(`/out/slide-00000${index + 1}.pptx`) as Buffer)
    );
    const slides = entries.filter(
      (entry) => entry.name.startsWith("ppt/slides/") && entry.name.endsWith(".xml")
    );
    expect(slides).toHaveLength(1);
    expect(decode(slides[0]!.payload)).toContain(`name="${name}"`);
    expect(entries.some((entry) => entry.name.startsWith("ppt/slideMasters/"))).toBe(true);
  }
  const schemaResponse = await engine.execute(invocation(["schema", "slides", "split", "--json"]));
  const schema = JSON.parse(decode(schemaResponse.stdout)).data.operations["slides.split"];
  expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
});

it("refuses nontransactional publication unless partial output is explicit", async () => {
  const request = invocation([...split, "--json"]);
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(decode(response.stdout))).toMatchObject({
    data: null,
    affected: 0,
    errors: [{ code: "publication-unsupported" }]
  });
  expect(request.publishOutput).not.toHaveBeenCalled();
});

it("reports only published outputs after a partial publication failure", async () => {
  const request = invocation([...split, "--allow-partial-output", "--json"]);
  request.publishOutput
    .mockImplementationOnce(async (item) => {
      request.volume.writeFileSync(item.outputPath, item.bytes);
    })
    .mockRejectedValueOnce(new Error("failed"));
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(3);
  const result = JSON.parse(decode(response.stdout));
  expect(result).toMatchObject({
    ok: false,
    affected: 1,
    data: { outputs: [{ path: "/out/slide-000001.pptx" }] },
    errors: [{ code: "io-failure" }]
  });
  expect(result.data.outputs).toHaveLength(1);
  expect(request.volume.existsSync("/out/slide-000002.pptx")).toBe(false);
});

it("validates every selection before any partial publication", async () => {
  const request = invocation([
    "slides",
    "split",
    "/input.pptx",
    "--slides",
    "[1,9]",
    "--output-dir",
    "/out",
    "--allow-partial-output",
    "--json"
  ]);
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(1);
  expect(request.publishOutput).not.toHaveBeenCalled();
});

it("preflights all destinations and leaves no outputs on a predictable conflict", async () => {
  const request = invocation([...split, "--allow-partial-output", "--json"]);
  request.preflightOutput.mockRejectedValueOnce(new Error("conflict"));
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(3);
  expect(JSON.parse(decode(response.stdout))).toMatchObject({
    data: null,
    affected: 0,
    locations: []
  });
  expect(request.publishOutput).not.toHaveBeenCalled();
});

it("reserves a complete failure manifest before the first publication", async () => {
  const request = invocation([
    ...split,
    "--allow-partial-output",
    "--json",
    "--limit",
    "maxOutputBytes=512"
  ]);
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(4);
  expect(request.publishOutput).not.toHaveBeenCalled();
  expect(request.preflightOutput).not.toHaveBeenCalled();
});

it("uses an explicit all-or-nothing publication callback without partial authorization", async () => {
  const request = invocation([...split, "--json"]);
  const publishOutputs = vi.fn(async (items: readonly PptxPublicationRequest[]) => {
    for (const item of items) request.volume.writeFileSync(item.outputPath, item.bytes);
  });
  const response = await engine.execute({ ...request, publishOutputs });
  expect(response.exitCode, decode(response.stdout)).toBe(0);
  expect(publishOutputs).toHaveBeenCalledTimes(1);
  expect(request.publishOutput).not.toHaveBeenCalled();
});

it("reports a failed transaction without claiming any published output", async () => {
  const request = invocation([...split, "--json"]);
  const publishOutputs = vi.fn(async (_items: readonly PptxPublicationRequest[]) => {
    throw new Error("transaction failed");
  });
  const response = await engine.execute({ ...request, publishOutputs });
  expect(response.exitCode).toBe(3);
  expect(JSON.parse(decode(response.stdout))).toMatchObject({
    ok: false,
    data: null,
    affected: 0,
    locations: []
  });
  expect(request.volume.existsSync("/out/slide-000001.pptx")).toBe(false);
});

it("retains the precise completed manifest when cancellation stops partial publication", async () => {
  const request = invocation([...split, "--allow-partial-output", "--json"]);
  const controller = new AbortController();
  request.publishOutput.mockImplementationOnce(async (item) => {
    request.volume.writeFileSync(item.outputPath, item.bytes);
    controller.abort();
  });
  const response = await engine.execute({ ...request, signal: controller.signal });
  expect(response.exitCode).toBe(130);
  const result = JSON.parse(decode(response.stdout));
  expect(result).toMatchObject({
    affected: 1,
    errors: [{ code: "cancelled" }],
    data: { outputs: [{ path: "/out/slide-000001.pptx" }] }
  });
  expect(result.data.outputs).toHaveLength(1);
  expect(request.publishOutput).toHaveBeenCalledTimes(1);
});

it("documents assembly schema paths, scoped sources and publication policy in help", async () => {
  const response = await engine.execute(invocation(["help"]));
  expect(decode(response.stdout)).toContain("slides merge | slides split");
  expect(decode(response.stdout)).toContain('--sources \'[{"vfsPath":"source.pptx"}]\'');
  expect(decode(response.stdout)).toContain("--allow-partial-output");
});

it("declares closed scoped merge inputs and validates partial failure manifests", async () => {
  const response = await engine.execute(invocation(["schema", "slides", "merge", "--json"]));
  const schema = JSON.parse(decode(response.stdout)).data.operations["slides.merge"];
  const options = compileJsonSchema(schema.options);
  expect(
    options.validate({ sources: [{ vfsPath: "/a.pptx" }], themePolicy: "source", dryRun: true }).ok
  ).toBe(true);
  expect(options.validate({ sources: ["/a.pptx"], themePolicy: "source", dryRun: true }).ok).toBe(
    false
  );
  expect(
    options.validate({
      sources: [{ vfsPath: "/a.pptx", unknown: 1 }],
      themePolicy: "source",
      dryRun: true
    }).ok
  ).toBe(false);
  expect(options.validate({ sources: [{ vfsPath: "/a.pptx" }], dryRun: true }).ok).toBe(false);
  const request = invocation([...split, "--allow-partial-output", "--json"]);
  request.publishOutput.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("failed"));
  const failed = JSON.parse(decode((await engine.execute(request)).stdout));
  const splitSchema = JSON.parse(
    decode((await engine.execute(invocation(["schema", "slides", "split", "--json"]))).stdout)
  ).data.operations["slides.split"];
  expect(compileJsonSchema(splitSchema.result).validate(failed).ok).toBe(true);
});

it("rejects combined input excess and missing merge selections before publication", async () => {
  const limited = createPptxCommandEngine({
    context: { ...context, limits: { ...context.limits, maxBytes: deck.length + 1 } },
    maxArgumentBytes: 65536,
    maxOutputBytes: 1048576
  });
  const request = invocation([...merge, "--output", "/merged.pptx", "--json"]);
  expect((await limited.execute(request)).exitCode).toBe(4);
  expect(request.publishOutput).not.toHaveBeenCalled();
  const missing = invocation([
    "slides",
    "merge",
    "/input.pptx",
    "--sources",
    '[{"vfsPath":"/a.pptx"}]',
    "--source-slides",
    "[9]",
    "--theme-policy",
    "source",
    "--output",
    "/merged.pptx",
    "--json"
  ]);
  expect((await engine.execute(missing)).exitCode).toBe(1);
  expect(missing.publishOutput).not.toHaveBeenCalled();
});

it("rejects unavailable destination theme mapping in the command core", async () => {
  const request = invocation([
    "slides",
    "merge",
    "/input.pptx",
    "--sources",
    '[{"vfsPath":"/a.pptx"}]',
    "--theme-policy",
    "destination",
    "--output",
    "/merged.pptx",
    "--json"
  ]);
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(decode(response.stdout))).toMatchObject({
    data: null,
    affected: 0,
    errors: [{ code: "unsupported-edit" }]
  });
  expect(request.publishOutput).not.toHaveBeenCalled();
});

it.each([
  [
    "slides",
    "merge",
    "-",
    "--sources",
    '[{"vfsPath":"-"}]',
    "--theme-policy",
    "source",
    "--dry-run"
  ],
  ["slides", "merge", "/input.pptx", "--sources", '[{"vfsPath":"/a.pptx"}]', "--dry-run"],
  [
    "slides",
    "merge",
    "/input.pptx",
    "--sources",
    '[{"vfsPath":"/a.pptx"}]',
    "--theme-policy",
    "source",
    "--output",
    "/a.pptx",
    "--force"
  ],
  ["slides", "split", "/input.pptx", "--slides", "[1,1]", "--output-dir", "/out"],
  ["slides", "split", "/input.pptx", "--slides", "[1]", "--output-dir", "-"]
])("rejects invalid assembly arguments before reads %j", async (...flags) => {
  const request = invocation([...flags, "--json"]);
  expect((await engine.execute(request)).exitCode).toBe(2);
  expect(request.readInput).not.toHaveBeenCalled();
});
