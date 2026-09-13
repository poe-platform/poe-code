import { Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
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
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 262144
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const original = createPresentation({}, context);
async function invocation(args: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.pptx", await original);
  return {
    volume,
    args: args.map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)),
    publishOutput: vi.fn(async (publication: PptxPublicationRequest) => {
      if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
    })
  };
}

describe("slide insertion command", () => {
  it("populates custom placeholder types and sparse indices through direct flags", async () => {
    const request = await invocation([
      "slides",
      "add",
      "/input.pptx",
      "--layout",
      "Survey",
      "--title",
      "Rain & river",
      "--placeholders-json",
      '[{"type":"body","index":42,"text":"Sample notes"},{"type":"subTitle","index":19,"text":"Measured today"}]',
      "--output",
      "/result.pptx",
      "--json"
    ]);
    const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const placeholder = (id: number, type: string, index: number) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}" idx="${index}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:t>Layout prompt</a:t></a:r></a:p></p:txBody></p:sp>`;
    const layout = `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="cust" preserve="1"><p:cSld name="Survey"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${placeholder(2, "title", 8)}${placeholder(3, "body", 42)}${placeholder(4, "subTitle", 19)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
    request.volume.writeFileSync(
      "/input.pptx",
      storedArchive(
        inspectZip(await original).map((entry) => ({
          name: entry.name,
          bytes:
            entry.name === "ppt/slideLayouts/slideLayout1.xml"
              ? new TextEncoder().encode(layout)
              : entry.payload
        }))
      )
    );
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(0);
    const bytes = new Uint8Array(request.volume.readFileSync("/result.pptx") as Buffer);
    const parts = new Map(inspectZip(bytes).map((entry) => [entry.name, decode(entry.payload)]));
    expect(parts.get("ppt/slides/slide1.xml")).toContain("Rain &amp; river");
    expect(parts.get("ppt/slides/slide1.xml")).toContain("Sample notes");
    expect(parts.get("ppt/slides/slide1.xml")).toContain("Measured today");
    expect(parts.get("ppt/slideLayouts/slideLayout1.xml")).toBe(layout);
  });
  it("rejects rich placeholder text without publishing a converted shape", async () => {
    const request = await invocation([
      "slides",
      "add",
      "/input.pptx",
      "--layout",
      "Chart panel",
      "--placeholders-json",
      '[{"type":"chart","index":9,"text":"Unsupported chart text"}]',
      "--output",
      "/result.pptx",
      "--json"
    ]);
    const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const layout = `<p:sldLayout xmlns:p="${p}" type="chart"><p:cSld name="Chart panel"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Chart slot"/><p:cNvSpPr/><p:nvPr><p:ph type="chart" idx="9"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld></p:sldLayout>`;
    request.volume.writeFileSync(
      "/input.pptx",
      storedArchive(
        inspectZip(await original).map((entry) => ({
          name: entry.name,
          bytes:
            entry.name === "ppt/slideLayouts/slideLayout1.xml"
              ? new TextEncoder().encode(layout)
              : entry.payload
        }))
      )
    );
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(1);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      operation: "slides.add",
      ok: false,
      affected: 0,
      errors: [{ code: "unsupported-edit" }]
    });
    expect(request.publishOutput).not.toHaveBeenCalled();
    expect(request.volume.existsSync("/result.pptx")).toBe(false);
  });
  it("inserts an explicitly bound slide and reports the publication", async () => {
    const request = await invocation([
      "slides",
      "add",
      "/input.pptx",
      "--layout",
      "/ppt/slideLayouts/slideLayout1.xml",
      "--position",
      "1",
      "--name",
      "Cedar & rain",
      "--hidden",
      "true",
      "--follow-master-background",
      "false",
      "--output",
      "/result.pptx",
      "--json"
    ]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(0);
    const bytes = new Uint8Array(request.volume.readFileSync("/result.pptx") as Buffer);
    const parts = new Map(inspectZip(bytes).map((entry) => [entry.name, decode(entry.payload)]));
    expect(parts.get("ppt/slides/slide1.xml")).toContain('name="Cedar &amp; rain"');
    expect(parts.get("ppt/slides/slide1.xml")).toContain('show="0"');
    expect(parts.get("ppt/slides/slide1.xml")).toContain("<p:bg>");
    expect(parts.get("ppt/slides/_rels/slide1.xml.rels")).toContain("slideLayout1.xml");
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      operation: "slides.add",
      ok: true,
      affected: 1,
      data: { outputs: [{ path: "/result.pptx", bytes: bytes.length }] }
    });
    expect(request.publishOutput.mock.calls[0]![0]).toMatchObject({
      inputPath: "/input.pptx",
      inPlace: false,
      force: false,
      dryRun: false
    });
  });
  it("keeps stdout binary and supports destination-free dry runs", async () => {
    const output = await invocation([
      "slides",
      "add",
      "/input.pptx",
      "--layout",
      "Blank",
      "--output",
      "-"
    ]);
    const binary = await engine.execute(output);
    expect(binary.exitCode, decode(binary.stderr)).toBe(0);
    expect(inspectZip(binary.stdout).some((entry) => entry.name === "ppt/slides/slide1.xml")).toBe(
      true
    );
    expect(output.publishOutput).not.toHaveBeenCalled();
    const dry = await invocation([
      "slides",
      "add",
      "/input.pptx",
      "--layout",
      "Blank",
      "--dry-run",
      "--json"
    ]);
    const result = await engine.execute(dry);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decode(result.stdout)).data).toMatchObject({
      outputs: [],
      fingerprint: null
    });
    expect(dry.publishOutput).not.toHaveBeenCalled();
  });
  it.each([
    [],
    ["--layout", "Blank"],
    ["--layout", "Blank", "--position", "0", "--dry-run"],
    ["--layout", "Blank", "--position", "1.5", "--dry-run"],
    ["--layout", "Blank", "--hidden", "yes", "--dry-run"],
    ["--layout", "Blank", "--slide", "1", "--dry-run"],
    ["--layout", "Blank", "--output", "-", "--json"],
    ["--layout", "Blank", "--in-place", "--output", "/other"],
    ["--layout", "Blank", "--layout", "Blank", "--dry-run"],
    [
      "--layout",
      "Blank",
      "--placeholders-json",
      '[{"type":"body","index":-1,"text":"x"}]',
      "--dry-run"
    ],
    [
      "--layout",
      "Blank",
      "--placeholders-json",
      '[{"type":"body","text":"x","extra":1}]',
      "--dry-run"
    ]
  ])("rejects invalid slide arguments %j before reading input", async (...args) => {
    const request = await invocation([
      "slides",
      "add",
      "/input.pptx",
      ...args,
      ...((args as readonly string[]).includes("--json") ? [] : ["--json"])
    ]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(2);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({ operation: "slides.add", ok: false });
    expect(request.readInput).not.toHaveBeenCalled();
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("publishes exact slide schemas and capability support", async () => {
    const response = await engine.execute(await invocation(["schema", "slides", "add", "--json"]));
    expect(response.exitCode).toBe(0);
    const schema = JSON.parse(decode(response.stdout)).data.operations["slides.add"];
    const validate = compileJsonSchema(schema.options);
    expect(
      validate.validate({ layout: "Blank", position: 1, hidden: false, dryRun: true }).ok
    ).toBe(true);
    expect(validate.validate({ layout: "Blank", position: 0, dryRun: true }).ok).toBe(false);
    expect(validate.validate({ dryRun: true }).ok).toBe(false);
    const result = await engine.execute(
      await invocation(["slides", "add", "/input.pptx", "--layout", "Blank", "--dry-run", "--json"])
    );
    expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(result.stdout))).ok).toBe(
      true
    );
    const capabilities = await engine.execute(await invocation(["capabilities", "--json"]));
    expect(JSON.parse(decode(capabilities.stdout)).data.features.slides.level).toBe("edit");
    const help = await engine.execute(await invocation(["help", "slides", "add"]));
    expect(decode(help.stdout)).toContain("pptx slides add INPUT --layout LAYOUT");
  });
});
