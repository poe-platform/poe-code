import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../tests/fixtures/archive.js";
import { createPptxCommandEngine } from "./command-engine.js";

const encode = (text: string) => new TextEncoder().encode(text);
const xmlLimits = { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 };
const relationshipLimits = { maxBytes: 8192, maxParts: 30, maxRelationships: 30 };
const options = {
  context: {
    limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
    archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 8192, maxTotalBytes: 32768, maxMembers: 30, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 8192, chunkSize: 512 },
    xmlLimits, relationshipLimits,
    validationLimits: { ...xmlLimits, ...relationshipLimits, maxEntries: 30 }
  },
  maxArgumentBytes: 65536, maxOutputBytes: 2097152
};
const files = {
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/main.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
  "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="main.xml"/></Relationships>',
  "main.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
};
function invocation(args: string[], invalid = false) {
  const volume = new Volume();
  volume.writeFileSync("/deck.pptx", Buffer.from(storedArchive(Object.entries(files).map(([name, text]) => ({ name, bytes: encode(invalid && name === "main.xml" ? '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>' : text) })))));
  const readInput = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Uint8Array));
  return { args: args.map(encode), readInput, signal: new AbortController().signal };
}
const data = (output: { stdout: Uint8Array }) => JSON.parse(new TextDecoder().decode(output.stdout));
describe("public semantic validation command", () => {
  it.each(["image", "table", "metadata", "replace"])("rejects removed spelling %s with the common help usage envelope", async (operation) => {
    const request = invocation([operation, "/deck.pptx", "--json"]);
    const output = await createPptxCommandEngine(options).execute(request);
    expect(output.exitCode).toBe(2);
    expect(data(output)).toMatchObject({ operation: "help", ok: false, data: null, affected: 0 });
    expect(request.readInput).not.toHaveBeenCalled();
  });
  it.each(["help", "schema", "version"])("declares discovery operation %s with a matching result schema", async (operation) => {
    const engine = createPptxCommandEngine(options);
    const register = data(await engine.execute(invocation(["schema", "--json"]))).data.operations;
    expect(register).toHaveProperty(operation);
    const result = data(await engine.execute(invocation([operation, "--json"])));
    expect(compileJsonSchema(register[operation].result).validate(result).ok).toBe(true);
  });
  it("validates an original bounded package and exposes truthful schemas", async () => {
    const engine = createPptxCommandEngine(options);
    const output = await engine.execute(invocation(["validate", "/deck.pptx", "--json"]));
    expect(output.exitCode).toBe(0);
    expect(data(output)).toMatchObject({ operation: "validate", ok: true, affected: 0, locations: [], data: { valid: true, schema: "not-checked", issues: [] } });
    const schema = data(await engine.execute(invocation(["schema", "validate", "--json"]))).data.operations.validate;
    expect(compileJsonSchema(schema.result).validate(data(output)).ok).toBe(true);
    expect(compileJsonSchema(schema.options).validate({ output: "/out.pptx" }).ok).toBe(false);
    const help = await engine.execute(invocation(["help", "validate"]));
    expect(new TextDecoder().decode(help.stdout)).toContain("semantic");
  });
  it("reports invalid semantic structure as an ordinary document failure", async () => {
    const output = await createPptxCommandEngine(options).execute(invocation(["validate", "/deck.pptx", "--json"], true));
    expect(output.exitCode).toBe(1);
    expect(data(output)).toMatchObject({ operation: "validate", ok: false, data: null, affected: 0 });
  });
  it("declares semantic validation as a read capability", async () => {
    const output = await createPptxCommandEngine(options).execute(invocation(["capabilities", "--json"]));
    expect(data(output).data.features.validation).toMatchObject({ level: "read", operations: ["validate"] });
  });
  it("uses explicit ordinary host ceilings without separate validation overrides", async () => {
    const { validationLimits: ignoredLimits, ...context } = options.context;
    expect((await createPptxCommandEngine({ ...options, context }).execute(invocation(["validate", "/deck.pptx", "--json"]))).exitCode).toBe(0);
  });
  it("lowers semantic ceilings and rejects output-only limits before admission", async () => {
    const engine = createPptxCommandEngine(options);
    expect((await engine.execute(invocation(["validate", "/deck.pptx", "--json", "--limit", "maxNodes=1"]))).exitCode).toBe(4);
    const request = invocation(["validate", "/deck.pptx", "--json", "--limit", "maxOutputBytes=512"]);
    expect((await engine.execute(request)).exitCode).toBe(2);
    expect(request.readInput).not.toHaveBeenCalled();
  });
  it.each([ ["--output", "/out.pptx"], ["--slide", "1"], ["--dry-run"], ["--force"], ["--json", "--json"] ])("rejects inapplicable or repeated flags before input admission: %s", async (...flags) => {
    const request = invocation(["validate", "/deck.pptx", "--json", ...flags]);
    expect((await createPptxCommandEngine(options).execute(request)).exitCode).toBe(2);
    expect(request.readInput).not.toHaveBeenCalled();
  });
});
