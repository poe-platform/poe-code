import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../../safe-bash-presentation-engine/tests/fixtures/archive.js";
import { createPptxCommandEngine } from "../src/command-engine.js";

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
  it("declares admitted common inspect limits in the public schema", async () => {
    const output = await createPptxCommandEngine(options).execute(invocation(["schema", "inspect", "--json"]));
    const schema = data(output).data.operations.inspect;
    expect(schema.options.properties).toHaveProperty("limit");
    expect(compileJsonSchema(schema.options).validate({ json: true, limit: { maxNodes: 10 } }).ok).toBe(true);
    expect(compileJsonSchema(schema.options).validate({ limit: { maxNodes: 0 } }).ok).toBe(false);
    expect(compileJsonSchema(schema.options).validate({ limit: { unknown: 1 } }).ok).toBe(false);
  });
  it("executes inspect with a valid lower common ceiling", async () => {
    const output = await createPptxCommandEngine(options).execute(invocation(["inspect", "/deck.pptx", "--json", "--limit", "maxNodes=100"]));
    expect(output.exitCode).toBe(0);
    expect(data(output)).toMatchObject({ operation: "inspect", ok: true });
  });
  it("rejects irrelevant inspect output-count limits before admission", async () => {
    const request = invocation(["inspect", "/deck.pptx", "--json", "--limit", "maxOutputs=1"]);
    expect((await createPptxCommandEngine(options).execute(request)).exitCode).toBe(2);
    expect(request.readInput).not.toHaveBeenCalled();
    const output = await createPptxCommandEngine(options).execute(invocation(["schema", "inspect", "--json"]));
    expect(compileJsonSchema(data(output).data.operations.inspect.options).validate({ limit: { maxOutputs: 1 } }).ok).toBe(false);
  });
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

it.each([false, true])('uses retained input and output sinks for shipped validation (invalid=%s)', async (invalid) => {
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs');
  const fs = createMemoryFileSystem(), request = invocation(['validate', '/deck.pptx', '--json'], invalid);
  const bytes = await request.readInput('/deck.pptx'); request.readInput.mockClear();
  request.readInput.mockImplementation(async () => { throw new Error('buffered engine input forbidden'); });
  fs.readFile = async () => { throw new Error('whole-file storage read forbidden'); };
  const chunks: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const openInput = vi.fn(async () => ({ size: bytes.length,
    async read(position: number, maximum: number) { return bytes.slice(position, position + Math.min(maximum, 17)); },
    async *stream() { throw new Error('retained range source expected'); yield new Uint8Array(); }
  }));
  const output = await createPptxCommandEngine(options).execute({ ...request, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput,
    stdout: { async write(chunk) { await Promise.resolve(); chunks.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } }
  } });
  expect(output.exitCode, chunks.map(chunk => new TextDecoder().decode(chunk)).join('') + new TextDecoder().decode(output.stderr)).toBe(invalid ? 1 : 0);
  expect(request.readInput).not.toHaveBeenCalled(); expect(openInput).toHaveBeenCalledWith('/deck.pptx', 65536);
  expect(output.stdout.length + output.stderr.length).toBe(0); expect(stderr).toEqual([]);
  expect(JSON.parse(chunks.map(chunk => new TextDecoder().decode(chunk)).join(''))).toMatchObject({ operation: 'validate', ok: !invalid });
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['/deck.pptx', '-'])('runs the default adapter through caller-backed storage for %s', async (path) => {
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const { createPptxCommand } = await import('../src/index.js');
  const owner = createMemoryFileSystem(), overrides: Partial<typeof owner> = {};
  const fs = new Proxy(owner, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  await fs.mkdir('/scratch');
  const bytes = storedArchive(Object.entries({ ...files, 'opaque.bin': 'x'.repeat(1100000),
    '[Content_Types].xml': files['[Content_Types].xml'].replace('</Types>', '<Default Extension="bin" ContentType="application/octet-stream"/></Types>')
  }).map(([name, text]) => ({ name, bytes: encode(text) })));
  await fs.writeFile('/deck.pptx', bytes);
  const open = fs.open!.bind(fs), openRead = fs.openReadFile!.bind(fs); let written = 0, outstanding = 0, peak = 0, handles = 0;
  overrides.readFile = async () => { throw new Error('whole-file reads forbidden'); };
  overrides.readStream = () => { throw new Error('buffered input adapter forbidden'); };
  overrides.openReadFile = async (...args) => {
    const handle = await openRead(...args); handles++;
    return { stat: handle.stat.bind(handle), async read(position, maximum, options) { expect(maximum).toBeLessThanOrEqual(16384); return handle.read(position, maximum, options); }, async close() { handles--; await handle.close(); } };
  };
  overrides.open = async (...args) => {
    expect(args[0].startsWith('/scratch/')).toBe(true);
    const handle = await open(...args); handles++;
    return new Proxy(handle, { get(target, key) {
      if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
        const length = parameters[0].length; written += length; outstanding += length; peak = Math.max(peak, outstanding);
        try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= length; }
      };
      if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const args = createCommandArguments(['validate', path, '--json']), stdout: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs,
    signal: new AbortController().signal,
    stdin: (async function* () { const chunk = new Uint8Array(4096); for (let offset = 0; offset < bytes.length; offset += chunk.length) { const length = Math.min(chunk.length, bytes.length - offset); chunk.set(bytes.subarray(offset, offset + length)); yield chunk.subarray(0, length); chunk.fill(255); } })(),
    stdout: { async write(chunk) { await Promise.resolve(); stdout.push(chunk.slice()); } }, stderr: { async write() { throw new Error('unexpected stderr'); } }
  });
  expect(result.exitCode, stdout.map(chunk => new TextDecoder().decode(chunk)).join('')).toBe(0); expect(JSON.parse(stdout.map(chunk => new TextDecoder().decode(chunk)).join(''))).toMatchObject({ ok: true });
  expect(written).toBeGreaterThan(1024 * 1024); expect(peak).toBeLessThanOrEqual(16384); expect(handles).toBe(0); expect(await fs.readdir('/scratch')).toEqual([]);
});
