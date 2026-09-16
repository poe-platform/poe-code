import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const encode = (text: string) => new TextEncoder().encode(text);
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
  relationshipLimits: { maxBytes: 8192, maxParts: 30, maxRelationships: 30 }
};
const bytes = storedArchive([
  {
    name: "[Content_Types].xml",
    bytes: encode(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
    )
  },
  {
    name: "deck.xml",
    bytes: encode(
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:u="urn:original:unknown"><u:payload u:mode="retained"/></p:presentation>'
    )
  }
]);
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 4000000
});
async function invoke(args: string[], input = bytes) {
  const volume = Volume.fromJSON({ "/input.pptx": Buffer.from(input) });
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const output = await engine.execute({
    args: args.map(encode),
    signal: new AbortController().signal,
    readInput
  });
  expect(volume.readFileSync("/input.pptx")).toEqual(Buffer.from(input));
  return { ...output, readInput, body: JSON.parse(new TextDecoder().decode(output.stdout)) };
}

describe("capability discovery", () => {
  it("assesses explicit input and reports unknown namespaces without claiming editing", async () => {
    const result = await invoke(["capabilities", "/input.pptx", "--json"]);
    expect(result.exitCode, JSON.stringify(result.body)).toBe(0);
    expect(result.readInput).toHaveBeenCalledTimes(1);
    expect(result.body.data.assessment).toMatchObject({
      complete: false,
      namespaces: expect.arrayContaining([
        {
          namespace: "urn:original:unknown",
          parts: ["/deck.xml"],
          level: "preserve",
          reason: expect.any(String)
        }
      ])
    });
    expect(result.body.data.assessment.affectedUnsupportedOperations).toEqual([]);
  });
  it("reports attribute-only namespaces and opaque compatibility branches", async () => {
    const input = storedArchive([
      {
        name: "deck.XML",
        bytes: encode(
          '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:q="urn:original:attribute" q:flag="yes"><mc:AlternateContent><mc:Choice Requires="q"><opaque xmlns="urn:original:choice"/></mc:Choice><mc:Fallback><opaque xmlns="urn:original:fallback"/></mc:Fallback></mc:AlternateContent></p:presentation>'
        )
      }
    ]);
    const result = await invoke(["capabilities", "/input.pptx", "--json"], input);
    expect(result.exitCode).toBe(0);
    expect(result.body.data.assessment.namespaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ namespace: "urn:original:attribute", level: "preserve" }),
        expect.objectContaining({ namespace: "urn:original:choice", level: "preserve" }),
        expect.objectContaining({ namespace: "urn:original:fallback", level: "preserve" })
      ])
    );
  });
  it.each([
    ["signature", "_xmlsignatures/payload.bin", "application/octet-stream", "opaque"],
    ["macro", "macro.bin", "application/vnd.ms-office.vbaProject", "opaque"],
    [
      "protection",
      "deck.xml",
      "application/xml",
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:modifyVerifier/></p:presentation>'
    ]
  ])(
    "reports proven XML replacement restrictions for %s",
    async (_name, part, contentType, content) => {
      const input = storedArchive([
        {
          name: "[Content_Types].xml",
          bytes: encode(
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${contentType}"/></Types>`
          )
        },
        { name: part, bytes: encode(content) }
      ]);
      const result = await invoke(["capabilities", "/input.pptx", "--json"], input);
      expect(result.exitCode).toBe(0);
      expect(result.body.data.assessment.affectedUnsupportedOperations).toEqual(["xml.set"]);
      expect(result.body.data.assessment.unsupported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ part: `/${part}`, reason: expect.stringContaining("xml.set") })
        ])
      );
    }
  );
  it("reports signature relationship restrictions without dereferencing external targets", async () => {
    const input = storedArchive([
      {
        name: "_rels/.rels",
        bytes: encode(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="signature" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="https://example.invalid/signature" TargetMode="External"/></Relationships>'
        )
      }
    ]);
    const result = await invoke(["capabilities", "/input.pptx", "--json"], input);
    expect(result.exitCode).toBe(0);
    expect(result.readInput).toHaveBeenCalledTimes(1);
    expect(result.body.data.assessment.affectedUnsupportedOperations).toEqual(["xml.set"]);
  });
  it("rejects unsupported output-count limits before input admission", async () => {
    const result = await invoke([
      "capabilities",
      "/input.pptx",
      "--limit",
      "maxOutputs=1",
      "--json"
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.readInput).not.toHaveBeenCalled();
  });
  it("enforces cumulative XML node budgets", async () => {
    const input = storedArchive([
      { name: "a.xml", bytes: encode("<a><b/></a>") },
      { name: "b.xml", bytes: encode("<a><b/></a>") }
    ]);
    const result = await invoke(
      ["capabilities", "/input.pptx", "--limit", "maxNodes=3", "--json"],
      input
    );
    expect(result.exitCode).toBe(4);
    expect(result.body.errors[0].code).toBe("resource-limit");
  });
  it("honors cancellation before admission", async () => {
    const controller = new AbortController();
    controller.abort();
    const readInput = vi.fn(async () => bytes);
    const result = await engine.execute({
      args: ["capabilities", "/input.pptx", "--json"].map(encode),
      signal: controller.signal,
      readInput
    });
    expect(result.exitCode).toBe(130);
    expect(readInput).not.toHaveBeenCalled();
  });
  it("links every static feature to declared operations and an explicit support level", async () => {
    const capabilities = await invoke(["capabilities", "--json"]);
    const schema = await invoke(["schema", "--json"]);
    expect(schema.exitCode).toBe(0);
    expect(capabilities.readInput).not.toHaveBeenCalled();
    for (const feature of Object.values(capabilities.body.data.features) as {
      level: string;
      operations: string[];
    }[]) {
      expect(["edit", "read", "preserve", "reject"]).toContain(feature.level);
      expect(feature.operations.length).toBeGreaterThan(0);
      for (const operation of feature.operations)
        expect(Object.hasOwn(schema.body.data.operations, operation)).toBe(true);
    }
  });
  it("publishes a schema accepting the actual assessment and rejecting unknown result fields", async () => {
    const schema = await invoke(["schema", "capabilities", "--json"]);
    expect(schema.exitCode).toBe(0);
    const validator = compileJsonSchema(schema.body.data.operations.capabilities.result);
    const result = await invoke(["capabilities", "/input.pptx", "--json"]);
    expect(validator.validate(result.body).ok).toBe(true);
    expect(
      validator.validate({ ...result.body, data: { ...result.body.data, unexpected: true } }).ok
    ).toBe(false);
  });
  it("documents assessment limitations and rejects selectors before reading input", async () => {
    const help = await invoke(["help", "capabilities", "--json"]);
    expect(help.exitCode).toBe(0);
    expect(help.body.data.usage).toContain("complete: false");
    const invalid = await invoke(["capabilities", "/input.pptx", "--slide", "1", "--json"]);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.readInput).not.toHaveBeenCalled();
  });
});
