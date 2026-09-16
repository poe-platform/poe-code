import { compileJsonSchema } from "toolcraft-schema";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { storedArchive } from "../tests/fixtures/archive.js";
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
const engine = createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 262144 });
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
it("extracts a small original package with zero read effects through an explicit nested-directory publisher", async () => {
  const volume = new Volume();
  const encode = (text: string) => new TextEncoder().encode(text);
  const parts = [
    { name: "[Content_Types].xml", bytes: encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/main.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>') },
    { name: "_rels/.rels", bytes: encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="main.xml"/></Relationships>') },
    { name: "main.xml", bytes: encode('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:notesSz cx="6858000" cy="9144000"/></p:presentation>') }
  ];
  volume.writeFileSync("/deck.pptx", Buffer.from(storedArchive(parts)));
  const output = await engine.execute({
    ...invocation(volume, ["extract", "/deck.pptx", "--output-dir", "/new/nested", "--json"]),
    publishOutputs: async (items) => {
      for (const item of items) {
        const parent = item.outputPath.slice(0, item.outputPath.lastIndexOf("/"));
        volume.mkdirSync(parent, { recursive: true });
        volume.writeFileSync(item.outputPath, item.bytes);
      }
    }
  });
  expect(output.exitCode, decode(output.stdout)).toBe(0);
  const envelope = JSON.parse(decode(output.stdout));
  expect(envelope.affected).toBe(0);
  expect(envelope.data.outputs).toHaveLength(3);
  for (const item of envelope.data.outputs) expect(volume.readFileSync(item.path)).toEqual(Buffer.from(parts.find((part) => `/${part.name}` === item.part)!.bytes));
  const schema = JSON.parse(decode((await engine.execute(invocation(volume, ["schema", "extract", "--json"]))).stdout)).data.operations.extract.result;
  expect(compileJsonSchema(schema).validate(envelope).ok).toBe(true);
  expect(compileJsonSchema(schema).validate({ ...envelope, affected: 3 }).ok).toBe(false);
});
function invocation(volume: Volume, args: string[]) {
  return {
    args: args.map((x) => new TextEncoder().encode(x)),
    signal: new AbortController().signal,
    readInput: async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async (item: PptxPublicationRequest) => {
      if (volume.existsSync(item.outputPath) && !item.force) throw new Error("Exists");
      if (!item.dryRun) volume.writeFileSync(item.outputPath, item.bytes);
    }
  };
}
it("extracts explicit parts and repacks an explicit hashed manifest through the command engine", async () => {
  const volume = Volume.fromJSON({ "/out": null, "/unrelated": "keep" });
  volume.writeFileSync("/deck.pptx", await createPresentation({}, context));
  const extract = await engine.execute(
    invocation(volume, [
      "extract",
      "/deck.pptx",
      "--output-dir",
      "/out",
      "--allow-partial-output",
      "--json"
    ])
  );
  expect(extract.exitCode, decode(extract.stdout)).toBe(0);
  const outputs = JSON.parse(decode(extract.stdout)).data.outputs;
  expect(outputs.length).toBeGreaterThan(3);
  const schema = await engine.execute(invocation(volume, ["schema", "extract", "--json"]));
  expect(
    compileJsonSchema(JSON.parse(decode(schema.stdout)).data.operations.extract.result).validate(
      JSON.parse(decode(extract.stdout))
    ).ok
  ).toBe(true);
  volume.writeFileSync(
    "/manifest.json",
    JSON.stringify({
      parts: outputs.map((x: { part: string; sha256: string; path: string }) => ({
        part: x.part,
        sha256: x.sha256,
        file: { vfsPath: x.path }
      }))
    })
  );
  const pack = await engine.execute(
    invocation(volume, [
      "pack",
      "--manifest",
      "/manifest.json",
      "--output",
      "/packed.pptx",
      "--json"
    ])
  );
  expect(pack.exitCode, decode(pack.stdout)).toBe(0);
  expect(volume.readFileSync("/unrelated", "utf8")).toBe("keep");
  const schemaPack = await engine.execute(invocation(volume, ["schema", "pack", "--json"]));
  expect(
    compileJsonSchema(JSON.parse(decode(schemaPack.stdout)).data.operations.pack.result).validate(
      JSON.parse(decode(pack.stdout))
    ).ok
  ).toBe(true);
  const check = await engine.execute(invocation(volume, ["inspect", "/packed.pptx", "--json"]));
  expect(check.exitCode, decode(check.stdout)).toBe(0);
  const observed: { part: string; bytes: Uint8Array }[] = [];
  const roundtrip = await engine.execute({
    ...invocation(volume, ["extract", "/packed.pptx", "--output-dir", "/repacked", "--json"]),
    publishOutputs: async (items) => {
      for (const [index, item] of items.entries())
        observed.push({ part: outputs[index].part, bytes: item.bytes });
    }
  });
  expect(roundtrip.exitCode, decode(roundtrip.stdout)).toBe(0);
  expect(observed).toHaveLength(outputs.length);
  for (const [index, item] of observed.entries())
    expect(Buffer.from(item.bytes)).toEqual(volume.readFileSync(outputs[index].path));
});
it("rejects invalid package command flags before reading", async () => {
  for (const args of [
    ["extract", "deck", "--output-dir", "-"],
    ["pack", "--manifest", "manifest", "--in-place"],
    ["extract", "deck", "--parts", '["/../bad"]', "--output-dir", "out"]
  ]) {
    let reads = 0;
    const result = await engine.execute({
      ...invocation(Volume.fromJSON({}), args),
      readInput: async () => {
        reads++;
        return new Uint8Array();
      }
    });
    expect(result.exitCode).toBe(2);
    expect(reads).toBe(0);
  }
});
it("preflights every destination before writing and preserves a colliding directory", async () => {
  const volume = Volume.fromJSON({ "/out/part-000002.xml": null, "/out/keep": "unchanged" });
  volume.writeFileSync("/deck.pptx", await createPresentation({}, context));
  const result = await engine.execute(
    invocation(volume, [
      "extract",
      "/deck.pptx",
      "--output-dir",
      "/out",
      "--allow-partial-output",
      "--json"
    ])
  );
  expect(result.exitCode).toBe(3);
  expect(volume.readdirSync("/out")).toEqual(["keep", "part-000002.xml"]);
  expect(JSON.parse(decode(result.stdout)).data).toBeNull();
});
it("reports exactly completed extracted parts on remote partial failure", async () => {
  const volume = Volume.fromJSON({ "/out": null });
  volume.writeFileSync("/deck.pptx", await createPresentation({}, context));
  const request = invocation(volume, [
    "extract",
    "/deck.pptx",
    "--output-dir",
    "/out",
    "--allow-partial-output",
    "--json"
  ]);
  let writes = 0;
  const result = await engine.execute({
    ...request,
    publishOutput: async (item) => {
      if (item.dryRun) return;
      if (++writes === 2) throw new Error("Remote write failed");
      volume.writeFileSync(item.outputPath, item.bytes);
    }
  });
  const envelope = JSON.parse(decode(result.stdout));
  expect(result.exitCode).toBe(3);
  expect(envelope.affected).toBe(1);
  expect(envelope.data.outputs).toHaveLength(1);
  expect(envelope.data.outputs[0].path).toBe("/out/part-000001.xml");
  const schema = await engine.execute(invocation(volume, ["schema", "extract", "--json"]));
  expect(
    compileJsonSchema(JSON.parse(decode(schema.stdout)).data.operations.extract.result).validate(
      envelope
    ).ok
  ).toBe(true);
});
it("resolves manifest member files relative to the manifest and dry runs without publication", async () => {
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/deck.pptx", await createPresentation({}, context));
  const request = invocation(volume, [
    "extract",
    "/deck.pptx",
    "--output-dir",
    "/work",
    "--allow-partial-output",
    "--json"
  ]);
  const extracted = await engine.execute(request);
  const outputs = JSON.parse(decode(extracted.stdout)).data.outputs;
  volume.writeFileSync(
    "/work/list.json",
    JSON.stringify({
      parts: outputs.map((x: { part: string; sha256: string; name: string }) => ({
        part: x.part,
        sha256: x.sha256,
        file: { vfsPath: x.name }
      }))
    })
  );
  let writes = 0;
  const result = await engine.execute({
    ...invocation(volume, ["pack", "--manifest", "/work/list.json", "--dry-run", "--json"]),
    publishOutput: async () => {
      writes++;
    }
  });
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(writes).toBe(0);
  expect(JSON.parse(decode(result.stdout)).data).toMatchObject({
    outputs: [],
    fingerprint: null,
    dryRun: true
  });
});
it("publishes a complete extraction transaction and exposes closed discovery results", async () => {
  const volume = Volume.fromJSON({ "/out": null });
  volume.writeFileSync("/deck.pptx", await createPresentation({}, context));
  let preflights = 0;
  let count = 0;
  const result = await engine.execute({
    ...invocation(volume, ["extract", "/deck.pptx", "--output-dir", "/out", "--json"]),
    preflightOutput: async () => {
      preflights++;
    },
    publishOutputs: async (items) => {
      expect(preflights).toBe(items.length);
      count = items.length;
    }
  });
  expect(result.exitCode).toBe(0);
  expect(count).toBeGreaterThan(3);
  for (const operation of ["extract", "pack"]) {
    const schema = await engine.execute(invocation(volume, ["schema", operation, "--json"]));
    expect(schema.exitCode, decode(schema.stdout)).toBe(0);
    expect(
      JSON.parse(decode(schema.stdout)).data.operations[operation].options.additionalProperties
    ).toBe(false);
    const help = await engine.execute(invocation(volume, [operation, "--help"]));
    expect(decode(help.stdout)).toContain("pack --manifest");
  }
});
it("admits output budgets and publication permission before any extracted writes", async () => {
  const volume = Volume.fromJSON({ "/out": null });
  volume.writeFileSync("/deck.pptx", await createPresentation({}, context));
  for (const [flags, status] of [
    [[], 3],
    [["--allow-partial-output", "--limit", "maxOutputs=1"], 4],
    [["--allow-partial-output", "--limit", "maxOutputBytes=512"], 4]
  ] as const) {
    const result = await engine.execute(
      invocation(volume, ["extract", "/deck.pptx", "--output-dir", "/out", "--json", ...flags])
    );
    expect(result.exitCode, decode(result.stdout)).toBe(status);
    expect(volume.readdirSync("/out")).toEqual([]);
  }
});
it("rejects duplicate manifest keys and part aliases before reading members", async () => {
  const volume = Volume.fromJSON({
    "/duplicate.json": '{"parts":[],"parts":[]}',
    "/aliases.json": JSON.stringify({
      parts: ["/a.xml", "/A.xml"].map((part) => ({
        part,
        sha256: "0".repeat(64),
        file: { vfsPath: "member.xml" }
      }))
    })
  });
  for (const manifest of ["/duplicate.json", "/aliases.json"]) {
    const request = invocation(volume, ["pack", "--manifest", manifest, "--dry-run", "--json"]);
    const reads: string[] = [];
    const result = await engine.execute({
      ...request,
      readInput: async (path) => {
        reads.push(path);
        return request.readInput(path);
      }
    });
    expect(result.exitCode, decode(result.stdout)).toBe(2);
    expect(reads).toEqual([manifest]);
  }
});
