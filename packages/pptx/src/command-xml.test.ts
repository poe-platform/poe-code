import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../tests/fixtures/archive.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { getXmlPart } from "./xml-parts.js";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const original = `<p:presentation xmlns:p="${p}"><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
const changed = `<p:presentation xmlns:p="${p}"><p:sldSz cx="10000000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
const archive = storedArchive([
  {
    name: "[Content_Types].xml",
    bytes: encode(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/deck.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'
    )
  },
  {
    name: "_rels/.rels",
    bytes: encode(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="deck.xml"/></Relationships>'
    )
  },
  { name: "deck.xml", bytes: encode(original) },
  {
    name: "_rels/deck.xml.rels",
    bytes: encode(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    )
  }
]);
const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 30,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 30, maxRelationships: 30 },
  validationLimits: {
    maxBytes: 8192,
    maxNodes: 1000,
    maxDepth: 30,
    maxParts: 30,
    maxRelationships: 30,
    maxEntries: 30
  }
};
const options = { context, maxArgumentBytes: 65536, maxOutputBytes: 65536 };
function invocation(args: string[]) {
  const volume = Volume.fromJSON({ "/deck.pptx": Buffer.from(archive), "/change.xml": changed });
  return {
    args: args.map(encode),
    signal: new AbortController().signal,
    readInput: vi.fn(
      async (path: string): Promise<Uint8Array> =>
        new Uint8Array(volume.readFileSync(path) as Buffer)
    ),
    publishOutput: vi.fn(async () => {})
  };
}
describe("XML command contracts", () => {
  it("returns exact original bytes and explicitly labels pretty text", async () => {
    const engine = createPptxCommandEngine(options);
    const args = ["xml", "get", "/deck.pptx", "--part", "/deck.xml", "--scope", "presentation"];
    const raw = await engine.execute(invocation(args));
    expect(raw.exitCode).toBe(0);
    expect(raw.stdout).toEqual(encode(original));
    const pretty = await engine.execute(invocation([...args, "--pretty"]));
    expect(pretty.exitCode).toBe(0);
    expect(decode(pretty.stdout)).toContain("Pretty XML (not original bytes)");
    const json = JSON.parse(decode((await engine.execute(invocation([...args, "--json"]))).stdout));
    expect(json).toMatchObject({
      operation: "xml.get",
      affected: 0,
      data: { part: "/deck.xml", format: "original", xml: original }
    });
  });
  it("validates before publication and performs dry-run without needing a destination", async () => {
    const engine = createPptxCommandEngine(options);
    const args = [
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      "/deck.xml",
      "--scope",
      "presentation",
      "--file",
      "/change.xml"
    ];
    const request = invocation([...args, "--output", "/new.pptx", "--force", "--json"]);
    const output = await engine.execute(request);
    expect(output.exitCode).toBe(0);
    expect(JSON.parse(decode(output.stdout))).toMatchObject({ operation: "xml.set", affected: 1 });
    expect(request.publishOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: "/deck.pptx",
        outputPath: "/new.pptx",
        force: true,
        inPlace: false,
        dryRun: false,
        originalBytes: archive
      })
    );
    const dry = invocation([...args, "--dry-run", "--json"]);
    expect((await engine.execute(dry)).exitCode).toBe(0);
    expect(dry.publishOutput).not.toHaveBeenCalled();
  });
  it.each([
    ["--output", "/deck.pptx", "--force"],
    ["--output", "/new.pptx", "--in-place"],
    ["--force", "--dry-run"],
    ["--output", "-", "--json"],
    ["--output", "/a", "-o", "/b"],
    []
  ])("rejects conflicting publication options before input reads: %j", async (...flags) => {
    const request = invocation([
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      "/deck.xml",
      "--file",
      "/change.xml",
      ...flags
    ]);
    expect((await createPptxCommandEngine(options).execute(request)).exitCode).toBe(2);
    expect(request.readInput).not.toHaveBeenCalled();
  });
  it("keeps binary stdout pure and validates proposed dry-run destinations", async () => {
    const engine = createPptxCommandEngine(options);
    const args = [
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      "/deck.xml",
      "--scope",
      "presentation",
      "--file",
      "/change.xml"
    ];
    const binary = invocation([...args, "--output", "-"]);
    const output = await engine.execute(binary);
    expect(output.exitCode).toBe(0);
    expect([...output.stdout.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    expect(output.stderr).toEqual(new Uint8Array());
    expect(binary.publishOutput).not.toHaveBeenCalled();
    const dry = invocation([...args, "--in-place", "--dry-run", "--json"]);
    expect((await engine.execute(dry)).exitCode).toBe(0);
    expect(dry.publishOutput).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: "/deck.pptx", inPlace: true, dryRun: true })
    );
    const dryStdout = invocation([...args, "--output", "-", "--dry-run", "--json"]);
    expect(JSON.parse(decode((await engine.execute(dryStdout)).stdout))).toMatchObject({
      ok: true,
      data: { dryRun: true }
    });
  });
  it("rejects invalid replacements before publication", async () => {
    const request = invocation([
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      "/deck.xml",
      "--scope",
      "presentation",
      "--file",
      "/bad.xml",
      "--in-place",
      "--json"
    ]);
    request.readInput.mockImplementation(async (path) =>
      path === "/bad.xml" ? encode("<broken>") : archive
    );
    const output = await createPptxCommandEngine(options).execute(request);
    expect(output.exitCode).toBe(1);
    expect(JSON.parse(decode(output.stdout))).toMatchObject({ ok: false, affected: 0 });
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("prevents publication when the result would exceed the output bound", async () => {
    const longPart = "/" + "a".repeat(220) + ".xml";
    const source = storedArchive([
      {
        name: "[Content_Types].xml",
        bytes: encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="${longPart}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`
        )
      },
      {
        name: "_rels/.rels",
        bytes: encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${longPart.slice(1)}"/></Relationships>`
        )
      },
      { name: longPart.slice(1), bytes: encode(original) }
    ]);
    const request = invocation([
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      longPart,
      "--scope",
      "presentation",
      "--file",
      "/change.xml",
      "--in-place",
      "--json"
    ]);
    request.readInput.mockImplementation(async (path) =>
      path === "/change.xml" ? encode(changed) : source
    );
    const output = await createPptxCommandEngine({ ...options, maxOutputBytes: 512 }).execute(
      request
    );
    expect(output.exitCode).toBe(4);
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("classifies replacement byte admission limits and never publishes", async () => {
    const request = invocation([
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      "/deck.xml",
      "--scope",
      "presentation",
      "--file",
      "/change.xml",
      "--in-place",
      "--json"
    ]);
    request.readInput.mockImplementation(async (path) => {
      if (path === "/change.xml")
        throw Object.assign(new Error("private input detail"), { code: "resource-limit" });
      return archive;
    });
    const output = await createPptxCommandEngine(options).execute(request);
    expect(output.exitCode).toBe(4);
    expect(JSON.parse(decode(output.stdout))).toMatchObject({
      ok: false,
      affected: 0,
      errors: [{ code: "resource-limit" }]
    });
    expect(decode(output.stdout)).not.toContain("private input detail");
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("lowers declared limits and rejects duplicate, unknown and raised ceilings", async () => {
    const args = [
      "xml",
      "get",
      "/deck.pptx",
      "--part",
      "/deck.xml",
      "--scope",
      "presentation",
      "--json"
    ];
    const engine = createPptxCommandEngine(options);
    expect((await engine.execute(invocation([...args, "--limit", "maxNodes=1"]))).exitCode).toBe(4);
    for (const limits of [
      ["maxNodes=1001"],
      ["unknown=1"],
      ["maxNodes=2", "maxNodes=3"],
      ["maxOutputBytes=511"]
    ]) {
      const request = invocation([...args, ...limits.flatMap((value) => ["--limit", value])]);
      expect((await engine.execute(request)).exitCode).toBe(2);
      expect(request.readInput).not.toHaveBeenCalled();
    }
    expect(
      (
        await engine.execute(
          invocation([...args, "--limit", "maxNodes=800", "--limit", "maxDepth=25"])
        )
      ).exitCode
    ).toBe(0);
  });
  it("maps closed publication error codes without exposing capability messages", async () => {
    for (const [code, status] of [
      ["stale-selection", 1],
      ["stale-input", 1],
      ["publication-unsupported", 1],
      ["resource-limit", 4],
      ["io-failure", 3]
    ] as const) {
      const request = invocation([
        "xml",
        "set",
        "/deck.pptx",
        "--part",
        "/deck.xml",
        "--scope",
        "presentation",
        "--file",
        "/change.xml",
        "--in-place",
        "--json"
      ]);
      request.publishOutput.mockRejectedValue(Object.assign(new Error("secret"), { code }));
      const output = await createPptxCommandEngine(options).execute(request);
      expect(output.exitCode).toBe(status);
      expect(JSON.parse(decode(output.stdout))).toMatchObject({
        ok: false,
        affected: 0,
        errors: [{ code }]
      });
      expect(decode(output.stdout)).not.toContain("secret");
    }
  });
  it.each(["/[Content_Types].xml", "/_rels/.rels", "/_rels/deck.xml.rels"])(
    "reads exact metadata XML in explicit shared scope: %s",
    async (part) => {
      const engine = createPptxCommandEngine(options);
      const args = ["xml", "get", "/deck.pptx", "--part", part];
      const sdk = await getXmlPart(archive, part, context);
      const output = await engine.execute(invocation([...args, "--scope", "shared"]));
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toEqual(sdk.bytes);
      expect(output.stderr).toEqual(new Uint8Array());
      expect(decode(output.stdout)).toContain(
        part === "/_rels/.rels"
          ? '<Relationship Id="main"'
          : part === "/_rels/deck.xml.rels"
            ? "<Relationships xmlns="
            : '<Override PartName="/deck.xml"'
      );
      const json = JSON.parse(
        decode((await engine.execute(invocation([...args, "--scope", "shared", "--json"]))).stdout)
      );
      expect(json).toMatchObject({
        operation: "xml.get",
        ok: true,
        affected: 0,
        locations: [{ scope: "shared", owner: part, objectId: part, coordinateSystem: "identity" }]
      });
      expect(json.locations[0].fingerprint).toHaveLength(64);
      expect(
        [...json.locations[0].fingerprint].every((character) =>
          "abcdef0123456789".includes(character)
        )
      ).toBe(true);
      expect(json.data).not.toHaveProperty("token");
      expect((await engine.execute(invocation(args))).exitCode).toBe(1);
      expect((await engine.execute(invocation([...args, "--scope", "slides"]))).exitCode).toBe(1);
      expect(
        (
          await engine.execute(
            invocation([
              "xml",
              "set",
              "/deck.pptx",
              "--part",
              part,
              "--scope",
              "shared",
              "--file",
              "/change.xml",
              "--dry-run"
            ])
          )
        ).exitCode
      ).toBe(1);
    }
  );
  it("advertises both operation schemas and rejects invalid set options", async () => {
    const engine = createPptxCommandEngine(options);
    for (const action of ["get", "set"]) {
      const out = await engine.execute(invocation(["schema", "xml", action, "--json"]));
      expect(out.exitCode).toBe(0);
      const schema = JSON.parse(decode(out.stdout)).data.operations[`xml.${action}`];
      expect(schema).toBeDefined();
      const operationArgs = [
        "xml",
        action,
        "/deck.pptx",
        "--part",
        "/deck.xml",
        "--scope",
        "presentation",
        "--json",
        ...(action === "set" ? ["--file", "/change.xml", "--dry-run"] : [])
      ];
      const result = JSON.parse(decode((await engine.execute(invocation(operationArgs))).stdout));
      expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
      expect(compileJsonSchema(schema.result).validate({ ...result, affected: 2 }).ok).toBe(false);
      expect(
        compileJsonSchema(schema.options).validate({ part: "/deck.xml", surprise: true }).ok
      ).toBe(false);
    }
  });
});
