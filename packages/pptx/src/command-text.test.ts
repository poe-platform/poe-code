import { Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readSelectionIndex } from "./selectors.js";
import { createPptxCommandEngine } from "./command-engine.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (body: string) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const parts = {
  "_rels/.rels": rels(`<Relationship Id="deck" Type="${r}/officeDocument" Target="deck.xml"/>`),
  "deck.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="page"/></p:sldIdLst></p:presentation>`,
  "_rels/deck.xml.rels": rels(`<Relationship Id="page" Type="${r}/slide" Target="page.xml"/>`),
  "page.xml": `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Caption"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>雪 café</a:t></a:r><a:br/><a:fld id="stamp" type="datetime"><a:t>yesterday</a:t></a:fld></a:p><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
};
const bytes = storedArchive(
  Object.entries(parts).map(([name, xml]) => ({ name, bytes: encode(xml) }))
);
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
function fixture(source = bytes) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", source);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  return {
    readInput,
    run: (args: string[]) =>
      engine.execute({ args: args.map(encode), signal: new AbortController().signal, readInput })
  };
}
describe("structured text commands", () => {
  it.each([["text", "get"], ["text"]])(
    "reads structural content through %j",
    async (...command) => {
      const output = await fixture().run([...command, "/deck.pptx", "--json"]);
      expect(output.exitCode).toBe(0);
      const result = JSON.parse(decode(output.stdout));
      expect(result).toMatchObject({
        operation: "text.get",
        ok: true,
        affected: 0,
        data: {
          order: "structural",
          text: "雪 café\vyesterday\n",
          segments: [
            {
              text: "雪 café\vyesterday\n",
              paragraphs: [
                {
                  text: "雪 café\vyesterday",
                  inlines: [
                    { kind: "run", text: "雪 café" },
                    { kind: "break", text: "\v" },
                    {
                      kind: "field",
                      cachedText: "yesterday",
                      fieldId: "stamp",
                      fieldType: "datetime"
                    }
                  ]
                },
                { text: "", inlines: [] }
              ]
            }
          ]
        }
      });
      expect(result.locations).toHaveLength(1);
    }
  );
  it("emits text bytes and preserves a trailing empty paragraph", async () => {
    const result = await fixture().run(["text", "get", "/deck.pptx"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stdout)).toBe("雪 café\vyesterday\n");
    expect(result.stderr).toEqual(new Uint8Array());
  });
  it("selects an exact named shape within the slide", async () => {
    const result = await fixture().run([
      "text",
      "get",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Caption",
      "--json"
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decode(result.stdout)).data.text).toBe("雪 café\vyesterday\n");
  });
  it.each([
    ["--paragraph", "1"],
    ["--all"],
    ["--output", "/out.pptx"],
    ["--scope", "shared"],
    ["--scope", "notes-master", "--slide", "1"],
    ["--scope", "handout-master", "--slide", "1"],
    ["--shape", ""],
    ["--shape", "Caption"]
  ])("rejects unsupported or incomplete options %j before reading", async (...flags) => {
    const f = fixture();
    const result = await f.run(["text", "get", "/deck.pptx", ...flags, "--json"]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("keeps notes scoped to the chosen slide and reuses scoped object tokens", async () => {
    const source = storedArchive(
      Object.entries({
        ...parts,
        "_rels/page.xml.rels": rels(
          `<Relationship Id="notes" Type="${r}/notesSlide" Target="notes.xml"/>`
        ),
        "notes.xml": `<p:notes xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Speaker"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Speaker reminder</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
      }).map(([name, xml]) => ({ name, bytes: encode(xml) }))
    );
    const f = fixture(source);
    const selected = await f.run([
      "text",
      "get",
      "/deck.pptx",
      "--scope",
      "notes",
      "--slide",
      "1",
      "--json"
    ]);
    expect(selected.exitCode).toBe(0);
    expect(JSON.parse(decode(selected.stdout)).data.text).toBe("Speaker reminder");
    const index = await readSelectionIndex(source, context);
    const token = index.objects.find((object) => object.name === "Speaker")!.token;
    const byToken = await f.run(["text", "get", "/deck.pptx", "--select", token, "--json"]);
    expect(byToken.exitCode).toBe(0);
    expect(JSON.parse(decode(byToken.stdout)).data.text).toBe("Speaker reminder");
    const stale = await fixture().run(["text", "get", "/deck.pptx", "--select", token, "--json"]);
    expect(stale.exitCode).toBe(1);
    expect(JSON.parse(decode(stale.stdout)).errors[0].code).toBe("stale-selection");
  });
  it("enforces lowered output ceilings without partial JSON", async () => {
    const f = fixture();
    const output = await f.run([
      "text",
      "get",
      "/deck.pptx",
      "--limit",
      "maxOutputBytes=512",
      "--json"
    ]);
    expect(output.exitCode).toBe(4);
    expect(output.stdout.length).toBeLessThanOrEqual(512);
    expect(JSON.parse(decode(output.stdout))).toMatchObject({
      operation: "text.get",
      ok: false,
      data: null,
      errors: [{ code: "resource-limit" }]
    });
    expect(output.stderr).toEqual(new Uint8Array());
  });
  it("publishes a validating schema and honest read capabilities", async () => {
    const f = fixture();
    const schemaOutput = await f.run(["schema", "text", "get", "--json"]);
    expect(schemaOutput.exitCode).toBe(0);
    const schema = JSON.parse(decode(schemaOutput.stdout)).data.operations["text.get"];
    const result = JSON.parse(
      decode((await f.run(["text", "get", "/deck.pptx", "--json"])).stdout)
    );
    expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
    expect(schema.options.properties.paragraph).toBeUndefined();
    const capability = JSON.parse(decode((await f.run(["capabilities", "--json"])).stdout)).data
      .features.text;
    expect(capability.level).toBe("read");
    expect(capability.subset).toContain("structural");
  });
});
