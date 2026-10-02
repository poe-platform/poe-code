import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
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
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
let source: Uint8Array;
let destination: Uint8Array;
beforeAll(async () => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  source = await createPresentation({ slides: [{ name: "Inlet" }, { name: "Cliff" }] }, context);
  destination = await createPresentation({ slides: [{ name: "Harbor" }] }, context);
});
afterAll(() => vi.restoreAllMocks());
function invocation(flags: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/source.pptx", source);
  volume.writeFileSync("/destination.pptx", destination);
  return {
    volume,
    args: flags.map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)),
    publishOutput: vi.fn(async (publication: PptxPublicationRequest) => {
      if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
    })
  };
}
const importArgs = [
  "slides",
  "import",
  "/destination.pptx",
  "--source",
  "/source.pptx",
  "--source-slides",
  "[2,1]"
];

it("imports ordered source slides with default appearance policy and isolated publication", async () => {
  const request = invocation([...importArgs, "--output", "/result.pptx", "--json"]);
  const response = await engine.execute(request);
  expect(response.exitCode, decode(response.stdout)).toBe(0);
  const result = JSON.parse(decode(response.stdout));
  expect(result).toMatchObject({
    operation: "slides.import",
    affected: 2,
    data: {
      effects: [
        { action: "add", feature: "F08" },
        { action: "add", feature: "F08" }
      ]
    }
  });
  const entries = inspectZip(new Uint8Array(request.volume.readFileSync("/result.pptx") as Buffer));
  const slides = entries.filter(
    (entry) => entry.name.startsWith("ppt/slides/") && entry.name.endsWith(".xml")
  );
  expect(slides).toHaveLength(3);
  expect(slides.map((entry) => decode(entry.payload)).join("\n")).toContain('name="Cliff"');
  expect(request.volume.readFileSync("/source.pptx")).toEqual(Buffer.from(source));
  expect(request.volume.readFileSync("/destination.pptx")).toEqual(Buffer.from(destination));
  const schemaResponse = await engine.execute(invocation(["schema", "slides", "import", "--json"]));
  const schema = JSON.parse(decode(schemaResponse.stdout)).data.operations["slides.import"];
  expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
  const options = compileJsonSchema(schema.options);
  expect(options.validate({ source: "/source.pptx", sourceSlides: [2, 1], dryRun: true }).ok).toBe(
    true
  );
  expect(options.validate({ source: "/source.pptx", sourceSlides: [1, 1], dryRun: true }).ok).toBe(
    false
  );
  expect(options.validate({ source: "/source.pptx", sourceSlides: [], dryRun: true }).ok).toBe(
    false
  );
});

it("validates imports without publishing and keeps binary stdout clean", async () => {
  const dry = invocation([...importArgs, "--output", "-", "--dry-run", "--json"]);
  const checked = await engine.execute(dry);
  expect(checked.exitCode, decode(checked.stdout)).toBe(0);
  expect(JSON.parse(decode(checked.stdout))).toMatchObject({
    affected: 2,
    data: { outputs: [], fingerprint: null }
  });
  expect(dry.publishOutput).not.toHaveBeenCalled();
  const bytes = await engine.execute(
    invocation([...importArgs, "--position", "1", "--output", "-"])
  );
  expect(bytes.exitCode, decode(bytes.stderr)).toBe(0);
  expect(decode(bytes.stderr)).toBe("");
  expect(inspectZip(bytes.stdout).some((entry) => entry.name === "ppt/presentation.xml")).toBe(
    true
  );
});

it("rejects dimension conflicts by default and accepts explicit destination dimensions", async () => {
  const request = invocation([...importArgs, "--output", "/result.pptx", "--json"]);
  request.volume.writeFileSync(
    "/source.pptx",
    await createPresentation(
      {
        width: 9144000,
        height: 5486400,
        slides: [{ name: "Inlet" }, { name: "Cliff" }]
      },
      context
    )
  );
  const rejected = await engine.execute(request);
  expect(rejected.exitCode).toBe(1);
  expect(JSON.parse(decode(rejected.stdout))).toMatchObject({
    affected: 0,
    data: null,
    locations: [],
    errors: [{ code: "unsupported-edit" }]
  });
  expect(request.volume.readFileSync("/destination.pptx")).toEqual(Buffer.from(destination));
  expect(request.volume.existsSync("/result.pptx")).toBe(false);
  expect(request.publishOutput).not.toHaveBeenCalled();
  const accepted = await engine.execute({
    ...request,
    args: [
      ...importArgs,
      "--output",
      "/result.pptx",
      "--dimension-policy",
      "destination",
      "--json"
    ].map((value) => new TextEncoder().encode(value))
  });
  expect(accepted.exitCode, decode(accepted.stdout)).toBe(0);
  const parts = inspectZip(new Uint8Array(request.volume.readFileSync("/result.pptx") as Buffer));
  expect(decode(parts.find((entry) => entry.name === "ppt/presentation.xml")!.payload)).toContain(
    'cx="12192000" cy="6858000"'
  );
});

it("reports unavailable destination theme mapping without publication", async () => {
  const request = invocation([
    ...importArgs,
    "--theme-policy",
    "destination",
    "--output",
    "/result.pptx",
    "--json"
  ]);
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(decode(response.stdout))).toMatchObject({
    operation: "slides.import",
    affected: 0,
    data: null,
    locations: [],
    errors: [{ code: "unsupported-edit" }]
  });
  expect(request.publishOutput).not.toHaveBeenCalled();
  expect(request.volume.readFileSync("/source.pptx")).toEqual(Buffer.from(source));
  expect(request.volume.readFileSync("/destination.pptx")).toEqual(Buffer.from(destination));
});

it("rejects replacing the source even with force", async () => {
  const request = invocation([...importArgs, "--output", "/source.pptx", "--force", "--json"]);
  const response = await engine.execute(request);
  expect(response.exitCode).toBe(2);
  expect(request.readInput).not.toHaveBeenCalled();
  expect(request.publishOutput).not.toHaveBeenCalled();
});

it.each(["source", "destination"])("admits exactly one explicit stdin %s", async (stdin) => {
  const request = invocation([
    "slides",
    "import",
    stdin === "destination" ? "-" : "/destination.pptx",
    "--source",
    stdin === "source" ? "-" : "/source.pptx",
    "--source-slides",
    "[1]",
    "--output",
    "-"
  ]);
  const read = request.readInput;
  request.readInput = vi.fn(async (path: string) =>
    path === "-" ? new Uint8Array(stdin === "source" ? source : destination) : read(path)
  );
  const response = await engine.execute(request);
  expect(response.exitCode, decode(response.stderr)).toBe(0);
  expect(request.readInput.mock.calls.filter(([path]) => path === "-")).toHaveLength(1);
  expect(
    inspectZip(response.stdout).filter(
      (entry) => entry.name.startsWith("ppt/slides/") && entry.name.endsWith(".xml")
    )
  ).toHaveLength(2);
});

it.each([
  ["--source", "/source.pptx"],
  ["--source-slides", "[1]"],
  ["--source", "-", "--source-slides", "[1]"],
  ["--source", "/source.pptx", "--source-slides", "[]"],
  ["--source", "/source.pptx", "--source-slides", "[0]"],
  ["--source", "/source.pptx", "--source-slides", "[1,1]"],
  ["--source", "/source.pptx", "--source-slides", "[1]", "--theme-policy", "automatic"],
  ["--source", "/source.pptx", "--source-slides", "[1]", "--dimension-policy", "scale"],
  ["--source", "/source.pptx", "--source-slides", "[1]", "--slide", "1"]
])("rejects invalid import arguments before reading %j", async (...flags) => {
  const request = invocation(["slides", "import", "-", ...flags, "--dry-run", "--json"]);
  const response = await engine.execute(request);
  expect(response.exitCode, decode(response.stdout)).toBe(2);
  expect(JSON.parse(decode(response.stdout)).operation).toBe("slides.import");
  expect(request.readInput).not.toHaveBeenCalled();
});
