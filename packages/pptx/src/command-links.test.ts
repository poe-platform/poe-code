import { Volume } from "memfs";
import { beforeAll, afterAll, vi, it, expect } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import {
  createPresentation,
  createPptxCommandEngine,
  type PptxPublicationRequest
} from "./index.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
async function fixture() {
  const volume = Volume.fromJSON({});
  const input = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Read more", x: 0, y: 0, width: 100, height: 100, text: "Details" }] },
        {}
      ]
    },
    context
  );
  volume.writeFileSync("/deck.pptx", input);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (p: PptxPublicationRequest) => {
    if (!p.dryRun) volume.writeFileSync(p.outputPath, p.bytes);
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  const run = async (args: string[]) => {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput,
      publishOutput
    });
    return {
      ...result,
      text: new TextDecoder().decode(result.stdout),
      error: new TextDecoder().decode(result.stderr)
    };
  };
  return { volume, input, run, readInput, publishOutput };
}
it.each(["https://example.test/a?q=two&lang=pl#part", "../guide.html#entry"])(
  "sets and reads inert URL strings: %s",
  async (url) => {
    const f = await fixture();
    const set = await f.run([
      "links",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Read more",
      "--url",
      url,
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(set.exitCode, set.text + set.error).toBe(0);
    expect(JSON.parse(set.text)).toMatchObject({ operation: "links.set", affected: 1 });
    const list = await f.run(["links", "get", "/out.pptx", "--json"]);
    expect(list.exitCode, list.text).toBe(0);
    expect(JSON.parse(list.text).data.links[0]).toMatchObject({ url });
    const schema = await f.run(["schema", "links", "get", "--json"]);
    expect(
      compileJsonSchema(JSON.parse(schema.text).data.operations["links.get"].result).validate(
        JSON.parse(list.text)
      ).ok
    ).toBe(true);
  }
);
it("validates link destinations before reading and preserves dry runs", async () => {
  const f = await fixture();
  for (const flags of [
    [],
    ["--url", "https://example.test", "--target-slide", "2"],
    ["--url", "https://example.test", "--action", "next"],
    ["--target-slide", "1.5"],
    ["--action", "macro"]
  ]) {
    const result = await f.run([
      "links",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Read more",
      "--dry-run",
      "--json",
      ...flags
    ]);
    expect(result.exitCode, result.text).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
  const dry = await f.run([
    "links",
    "add",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--target-slide",
    "2",
    "--dry-run",
    "--json"
  ]);
  expect(dry.exitCode, dry.text).toBe(0);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.input);
});
it("lists empty links and advertises explicit action preservation", async () => {
  const f = await fixture();
  expect(JSON.parse((await f.run(["links", "list", "/deck.pptx", "--json"])).text)).toMatchObject({
    data: { links: [] },
    affected: 0
  });
  expect((await f.run(["links", "get", "/deck.pptx", "--json"])).exitCode).toBe(1);
  const caps = JSON.parse((await f.run(["capabilities", "--json"])).text);
  expect(caps.data.features.links.operations).toEqual([
    "links.list",
    "links.get",
    "links.add",
    "links.set",
    "links.remove"
  ]);
});
it("schema rejects incomplete records and conflicting payloads", async () => {
  const f = await fixture();
  const descriptor = JSON.parse((await f.run(["schema", "links", "set", "--json"])).text).data
    .operations["links.set"];
  const options = compileJsonSchema(descriptor.options);
  expect(
    options.validate({ slide: 1, shape: "Read more", url: "../manual.html", dryRun: true }).ok
  ).toBe(true);
  for (const invalid of [
    { slide: 1, dryRun: true },
    { slide: 1, url: "x", targetSlide: 2, dryRun: true },
    { slide: 1, url: "x", action: "next", dryRun: true },
    { slide: 1, url: "x", force: true, dryRun: true }
  ])
    expect(options.validate(invalid).ok).toBe(false);
  const listDescriptor = JSON.parse((await f.run(["schema", "links", "list", "--json"])).text).data
    .operations["links.list"];
  const result = JSON.parse((await f.run(["links", "list", "/deck.pptx", "--json"])).text);
  result.data.links = [{ url: "https://example.test" }];
  expect(compileJsonSchema(listDescriptor.result).validate(result).ok).toBe(false);
});
it("keeps both triggers visible and enforces explicit selection for edits", async () => {
  const f = await fixture();
  for (const trigger of ["click", "hover"]) {
    const add = await f.run([
      "links",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Read more",
      "--trigger",
      trigger,
      "--action",
      "next",
      "--in-place",
      "--json"
    ]);
    expect(add.exitCode, add.text).toBe(0);
  }
  const list = JSON.parse((await f.run(["links", "list", "/deck.pptx", "--json"])).text);
  expect(list.data.links.map((link: { trigger: string }) => link.trigger).sort()).toEqual([
    "click",
    "hover"
  ]);
  const duplicate = await f.run([
    "links",
    "add",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--action",
    "first",
    "--dry-run",
    "--json"
  ]);
  expect(duplicate.exitCode).toBe(1);
  expect((await f.run(["links", "remove", "/deck.pptx", "--in-place", "--json"])).exitCode).toBe(2);
  const remove = await f.run([
    "links",
    "remove",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--in-place",
    "--json"
  ]);
  expect(remove.exitCode, remove.text).toBe(0);
  expect(
    JSON.parse((await f.run(["links", "get", "/deck.pptx", "--json"])).text).data.links[0].trigger
  ).toBe("hover");
});
it("exposes bounded path and additional navigation mappings without dynamic evaluation", async () => {
  const f = await fixture();
  for (const action of ["last-viewed", "end-show"]) {
    const result = await f.run([
      "links",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Read more",
      "--action",
      action,
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode, result.text).toBe(0);
  }
  for (const path of ["{}", "[1.5]", "[-1]", "[null]"]) {
    const result = await f.run([
      "links",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Read more",
      "--url",
      "https://example.test",
      "--path",
      path,
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode).toBe(2);
  }
});
it("round-trips listed parent paths and counts multiple run links independently", async () => {
  const f = await fixture();
  const { setLink } = await import("./index.js");
  const { readPackage } = await import("./package-reader.js");
  const { parseXmlPart } = await import("./xml.js");
  const reader = await readPackage(f.input, context);
  const root = parseXmlPart(reader.get("/ppt/slides/slide1.xml"), context.xmlLimits).root;
  const parents: number[][] = [];
  const walk = (node: typeof root, path: number[]) => {
    if (["rPr", "defRPr", "endParaRPr"].includes(node.name.localName)) parents.push(path);
    node.children.forEach((child, index) => walk(child, [...path, index]));
  };
  walk(root, []);
  expect(parents.length).toBeGreaterThan(0);
  const selection = {
    kind: "object" as const,
    scope: "slides" as const,
    owner: "/ppt/slides/slide1.xml",
    name: "Read more"
  };
  const linked = await setLink(
    f.input,
    { selection, path: parents[0]!, url: "https://example.test/run" },
    context
  );
  f.volume.writeFileSync("/deck.pptx", linked);
  const read = JSON.parse((await f.run(["links", "get", "/deck.pptx", "--json"])).text);
  const path = JSON.stringify(read.data.links[0].parentPath);
  const flags = ["/deck.pptx", "--slide", "1", "--shape", "Read more", "--path", path];
  const get = await f.run(["links", "get", ...flags, "--json"]);
  expect(get.exitCode, get.text).toBe(0);
  const set = await f.run([
    "links",
    "set",
    ...flags,
    "--url",
    "../run.html",
    "--in-place",
    "--json"
  ]);
  expect(set.exitCode, set.text).toBe(0);
  const add = await f.run([
    "links",
    "add",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--url",
    "https://example.test/shape",
    "--in-place",
    "--json"
  ]);
  expect(add.exitCode, add.text).toBe(0);
  const ambiguous = await f.run([
    "links",
    "remove",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--dry-run",
    "--json"
  ]);
  expect(ambiguous.exitCode).toBe(1);
  const all = await f.run([
    "links",
    "remove",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--all",
    "--dry-run",
    "--json"
  ]);
  expect(all.exitCode, all.text).toBe(0);
  expect(JSON.parse(all.text).affected).toBe(2);
  const remove = await f.run(["links", "remove", ...flags, "--in-place", "--json"]);
  expect(remove.exitCode, remove.text).toBe(0);
  expect(JSON.parse(remove.text).affected).toBe(1);
  const remaining = JSON.parse((await f.run(["links", "get", "/deck.pptx", "--json"])).text);
  expect(remaining.data.links[0].url).toBe("https://example.test/shape");
});
it("rejects unsafe URL intent before requesting document bytes", async () => {
  const f = await fixture();
  for (const url of [
    "javascript:alert(1)",
    "file:///private/file",
    "data:text/plain,hello",
    " https://example.test",
    "folder\\file"
  ]) {
    const result = await f.run([
      "links",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Read more",
      "--url",
      url,
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode, result.text).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
});
it("reports literal relationship targets and validates their closed schema", async () => {
  const f = await fixture();
  const set = await f.run([
    "links",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--target-slide",
    "2",
    "--in-place",
    "--json"
  ]);
  expect(set.exitCode, set.text).toBe(0);
  const result = JSON.parse((await f.run(["links", "get", "/deck.pptx", "--json"])).text);
  expect(result.data.links[0]).toMatchObject({
    targetSlide: 2,
    targetReference: "slide2.xml",
    url: null
  });
  const descriptor = JSON.parse((await f.run(["schema", "links", "get", "--json"])).text).data
    .operations["links.get"];
  const schema = compileJsonSchema(descriptor.result);
  expect(schema.validate(result).ok).toBe(true);
  const link = result.data.links[0];
  delete link.targetReference;
  expect(schema.validate(result).ok).toBe(false);
  link.targetReference = 42;
  expect(schema.validate(result).ok).toBe(false);
});
it("writes text hover using the character-property element and reads it through CLI", async () => {
  const f = await fixture();
  const { readPackage } = await import("./package-reader.js");
  const { parseXmlPart } = await import("./xml.js");
  const { listLinks } = await import("./index.js");
  const reader = await readPackage(f.input, context);
  const root = parseXmlPart(reader.get("/ppt/slides/slide1.xml"), context.xmlLimits).root;
  let parentPath: number[] | undefined;
  const walk = (node: typeof root, path: number[]) => {
    if (["rPr", "defRPr", "endParaRPr"].includes(node.name.localName) && parentPath === undefined)
      parentPath = path;
    node.children.forEach((child, index) => walk(child, [...path, index]));
  };
  walk(root, []);
  expect(parentPath).toBeDefined();
  const flags = [
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Read more",
    "--path",
    JSON.stringify(parentPath),
    "--trigger",
    "hover"
  ];
  const set = await f.run([
    "links",
    "set",
    ...flags,
    "--url",
    "../hover.html",
    "--in-place",
    "--json"
  ]);
  expect(set.exitCode, set.text).toBe(0);
  const bytes = new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer);
  const after = await readPackage(bytes, context);
  let parent = parseXmlPart(after.get("/ppt/slides/slide1.xml"), context.xmlLimits).root;
  for (const index of parentPath!) parent = parent.children[index]!;
  expect(
    parent.children.map((child) => [child.name.namespace, child.name.localName])
  ).toContainEqual(["http://schemas.openxmlformats.org/drawingml/2006/main", "hlinkMouseOver"]);
  expect(parent.children.some((child) => child.name.localName === "hlinkHover")).toBe(false);
  expect((await listLinks(bytes, {}, context))[0]).toMatchObject({
    trigger: "hover",
    url: "../hover.html"
  });
  const listed = await f.run(["links", "get", ...flags, "--json"]);
  expect(listed.exitCode, listed.text).toBe(0);
  expect(JSON.parse(listed.text).data.links[0].trigger).toBe("hover");
  const removed = await f.run(["links", "remove", ...flags, "--in-place", "--json"]);
  expect(removed.exitCode, removed.text).toBe(0);
  expect(JSON.parse(removed.text).affected).toBe(1);
});
