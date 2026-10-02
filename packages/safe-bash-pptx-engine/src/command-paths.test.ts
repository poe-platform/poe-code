import { compileJsonSchema } from "toolcraft-schema";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readPackage } from "./package-reader.js";
import { parseXmlPart } from "./xml.js";
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
async function fixture() {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", await createPresentation({ slides: [{}] }, context));
  const readInput = vi.fn(async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(
    async (request: { dryRun: boolean; outputPath: string; bytes: Uint8Array }) => {
      if (!request.dryRun) fs.writeFileSync(request.outputPath, request.bytes);
    }
  );
  return {
    fs,
    readInput,
    publishOutput,
    run: async (args: string[]) => {
      const result = await engine.execute({
        args: [...args, "--json"].map((x) => new TextEncoder().encode(x)),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      });
      return { code: result.exitCode, value: JSON.parse(new TextDecoder().decode(result.stdout)) };
    }
  };
}
const path = {
  unit: "emu",
  width: 100,
  height: 100,
  commands: [
    { type: "move", x: 0, y: 0 },
    { type: "quadratic", cx: 50, cy: 100, x: 100, y: 0 },
    { type: "cubic", cx1: 80, cy1: 20, cx2: 20, cy2: 20, x: 0, y: 0 },
    { type: "close" }
  ]
};
const placement = [
  "--slide",
  "1",
  "--left",
  "0emu",
  "--top",
  "0emu",
  "--width",
  "1in",
  "--height",
  "1in"
];
it("creates ordered quadratic and cubic commands through the public command engine", async () => {
  const f = await fixture();
  const result = await f.run([
    "shapes",
    "paths",
    "add",
    "/deck.pptx",
    ...placement,
    "--name",
    "Ribbon",
    "--path",
    JSON.stringify(path),
    "--in-place"
  ]);
  expect(result.code).toBe(0);
  expect(result.value).toMatchObject({ operation: "shapes.paths.add", affected: 1, ok: true });
  const archive = await readPackage(
    new Uint8Array(f.fs.readFileSync("/deck.pptx") as Buffer),
    context
  );
  const xml = parseXmlPart(archive.get("/ppt/slides/slide1.xml"), context.xmlLimits);
  const tree = xml.root.children
    .find((x) => x.name.localName === "cSld")!
    .children.find((x) => x.name.localName === "spTree")!;
  const shape = tree.children.find((x) => x.name.localName === "sp")!;
  const geometry = shape.children
    .find((x) => x.name.localName === "spPr")!
    .children.find((x) => x.name.localName === "custGeom")!;
  const paths = geometry.children.find((x) => x.name.localName === "pathLst")!.children;
  expect(paths).toHaveLength(1);
  expect(paths[0]!.children.map((x) => x.name.localName)).toEqual([
    "moveTo",
    "quadBezTo",
    "cubicBezTo",
    "close"
  ]);
});
it("rejects malformed path arguments before input admission", async () => {
  const f = await fixture();
  const result = await f.run([
    "shapes",
    "paths",
    "add",
    "/deck.pptx",
    ...placement,
    "--path",
    JSON.stringify({ ...path, commands: [{ type: "arc" }] }),
    "--in-place"
  ]);
  expect(result.code).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
  expect(f.publishOutput).not.toHaveBeenCalled();
});
it("publishes path discovery metadata and bounded coordinate schema", async () => {
  const f = await fixture();
  const schema = await f.run(["schema", "shapes", "paths", "set"]);
  expect(schema.code).toBe(0);
  expect(JSON.stringify(schema.value)).toContain('"maximum":2147483647');
  const help = await f.run(["shapes", "paths", "add", "--help"]);
  expect(help.value.data.usage).toContain("--path JSON");
  expect(help.value.data.usage).toContain("winding evaluation");
  expect(help.value.data.usage).toContain("Read: list|get INPUT [selection]");
  expect(help.value.data.usage).toContain("Add placement: --left");
  expect(help.value.data.usage).not.toContain("INPUT --path JSON");
  expect(help.value.data.usage).not.toContain("Add requires --slide");
  expect((await f.run(["help"])).value.data.usage).toContain("shapes paths");
});
it("sets an existing path with polygon shorthand while dry-run retains bytes", async () => {
  const f = await fixture();
  expect(
    (
      await f.run([
        "shapes",
        "paths",
        "add",
        "/deck.pptx",
        ...placement,
        "--name",
        "Ribbon",
        "--path",
        JSON.stringify(path),
        "--in-place"
      ])
    ).code
  ).toBe(0);
  const original = f.fs.readFileSync("/deck.pptx");
  const args = [
    "shapes",
    "paths",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Ribbon",
    "--vertices",
    '[ {"x":0,"y":0},{"x":100,"y":0},{"x":0,"y":100}]',
    "--close",
    "true"
  ];
  const dry = await f.run([...args, "--dry-run"]);
  expect(dry).toMatchObject({ code: 0, value: { affected: 1, data: { dryRun: true } } });
  expect(f.fs.readFileSync("/deck.pptx")).toEqual(original);
  expect((await f.run([...args, "--in-place"])).code).toBe(0);
  expect(f.fs.readFileSync("/deck.pptx")).not.toEqual(original);
});
it.each([
  ["--path", JSON.stringify(path), "--vertices", "[[0,0],[10,10]]"],
  ["--path", JSON.stringify(path), "--close"],
  ["--vertices", "[[0,0],[10,10]]", "--close"],
  ["--path", JSON.stringify({ ...path, unit: "in" })],
  ["--path", JSON.stringify({ ...path, width: 2147483648 })],
  [
    "--path",
    JSON.stringify({
      ...path,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "line", x: "width", y: 0 }
      ]
    })
  ]
])("rejects conflicting or out-of-profile path input %j", async (...flags) => {
  const f = await fixture();
  expect(
    (
      await f.run([
        "shapes",
        "paths",
        "set",
        "/deck.pptx",
        "--slide",
        "1",
        "--shape",
        "Ribbon",
        ...flags,
        "--in-place"
      ])
    ).code
  ).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
});

it("reads path geometry and validates generated read and mutation schemas", async () => {
  const f = await fixture();
  expect(
    (
      await f.run([
        "shapes",
        "paths",
        "add",
        "/deck.pptx",
        ...placement,
        "--name",
        "Ribbon",
        "--path",
        JSON.stringify(path),
        "--in-place"
      ])
    ).code
  ).toBe(0);
  const read = await f.run([
    "shapes",
    "paths",
    "get",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Ribbon"
  ]);
  expect(read).toMatchObject({
    code: 0,
    value: { affected: 0, data: { records: [{ path, unsupported: false }] } }
  });
  const schema = (await f.run(["schema", "shapes", "paths", "get"])).value.data.operations[
    "shapes.paths.get"
  ];
  expect(compileJsonSchema(schema.result).validate(read.value).ok).toBe(true);
  const options = (await f.run(["schema", "shapes", "paths", "set"])).value.data.operations[
    "shapes.paths.set"
  ].options;
  const check = compileJsonSchema(options);
  expect(check.validate({ path, slide: 1, shape: "Ribbon", dryRun: true }).ok).toBe(true);
  expect(
    check.validate({
      path,
      vertices: [
        [0, 0],
        [1, 1]
      ],
      dryRun: true
    }).ok
  ).toBe(false);
  expect(
    check.validate({
      path: {
        ...path,
        commands: [
          { type: "move", x: 0, y: 0 },
          { type: "line", x: 2147483648, y: 0 }
        ]
      },
      dryRun: true
    }).ok
  ).toBe(false);
});

it.each([
  ["--vertices", '[{"x":0,"y":0},{"x":20,"y":20}]'],
  ["--vertices", '[{"x":0,"y":0},{"x":20,"y":20}]', "--close"],
  ["--vertices", "[[0,0],[20,20]]", "--close", "false"],
  ["--vertices", '[{"x":0,"y":0},{"x":20,"y":20}]', "--close", "maybe"],
  ["--path", JSON.stringify(path), "--name", "Ignored"]
])("requires explicit closure and exact path-set options %j", async (...flags) => {
  const f = await fixture();
  const result = await f.run([
    "shapes",
    "paths",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Ribbon",
    ...flags,
    "--in-place"
  ]);
  expect(result.code).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
});
it("edits an explicitly selected master without changing slide paths", async () => {
  const f = await fixture();
  const added = await f.run([
    "shapes",
    "paths",
    "add",
    "/deck.pptx",
    "--scope",
    "masters",
    "--part",
    "/ppt/slideMasters/slideMaster1.xml",
    "--left",
    "0emu",
    "--top",
    "0emu",
    "--width",
    "1in",
    "--height",
    "1in",
    "--name",
    "Master ribbon",
    "--path",
    JSON.stringify(path),
    "--in-place"
  ]);
  expect(added.code).toBe(0);
  const master = await f.run([
    "shapes",
    "paths",
    "get",
    "/deck.pptx",
    "--scope",
    "masters",
    "--part",
    "/ppt/slideMasters/slideMaster1.xml",
    "--shape",
    "Master ribbon"
  ]);
  expect(master.value.data.records[0].path).toEqual(path);
  const slide = await f.run(["shapes", "paths", "list", "/deck.pptx", "--slide", "1"]);
  expect(slide.value.data.records).toEqual([]);
});
