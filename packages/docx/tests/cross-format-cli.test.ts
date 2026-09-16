import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { pptxCommands } from "virtual-bash/commands/pptx";
import { createPresentation, createPptxCommandEngine, addImage } from "pptx";
import { createDocumentArchive, writeDocumentArchive, createDocxInspectionCommandEngine, insertDocumentImage } from "../src/index.js";

import { rasterPng, rasterGif } from "./fixtures/raster.js";

const encoder = new TextEncoder();
const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 1024 };
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 1024 },
  archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 32, maxPaxBytes: 1024, maxTextBytes: 16384, chunkSize: 1024 },
  xmlLimits: { maxBytes: 16384, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 16384, maxParts: 32, maxRelationships: 64 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

async function fixture(format: "docx" | "pptx", withImage = false) {
  const volume = Volume.fromJSON({});
  for (const [name, text] of [["left", "Harbor survey"], ["right", "Meadow survey"]]) {
    let bytes: Uint8Array;
    if (format === "docx") {
      const archive = await createDocumentArchive({ content: { version: 1, blocks: [{ kind: "paragraph", text: text! }] } }, { limits, signal: new AbortController().signal });
      const chunks: Uint8Array[] = [];
      await writeDocumentArchive(archive, { async write(chunk) { chunks.push(new Uint8Array(chunk)); } }, { order: "name", compression: "store" }, { limits, signal: new AbortController().signal });
      bytes = new Uint8Array(Buffer.concat(chunks));
    } else bytes = await createPresentation({ slides: [{ shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: text! }] }] }, context);
    if (withImage && name === "left") {
      if (format === "docx") {
        const chunks: Uint8Array[] = [];
        await insertDocumentImage(bytes, { operation: "images.add", options: { paragraph: 1, file: { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") }, output: "-" } },
          { limits, signal: new AbortController().signal, encoding: { order: "input", compression: "store" }, stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } } });
        bytes = new Uint8Array(Buffer.concat(chunks));
      } else bytes = await addImage(bytes, { slide: 1, bytes: rasterPng(), contentType: "image/png" }, context);
    }
    volume.writeFileSync(`/${name}.${format}`, bytes);
  }
  volume.writeFileSync(`/bad.${format}`, "Invalid original input");
  volume.writeFileSync(`/oversize.${format}`, new Uint8Array(limits.maxArchiveBytes + 1));
  if (withImage) volume.writeFileSync("/pixel.gif", rasterGif());
  const fs = new MemoryFileSystem();
  for (const path of volume.readdirSync("/") as string[]) await fs.writeFile(`/${path}`, new Uint8Array(volume.readFileSync(`/${path}`) as Buffer));
  const readPublished = fs.readFile.bind(fs);
  const publications = [vi.spyOn(fs, "writeFile"), vi.spyOn(fs, "createStagedFile"), vi.spyOn(fs, "publishStagedFile"), vi.spyOn(fs, "writeFileConditional")];
  const readFile = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  fs.readFile = readFile;
  fs.readStream = path => ({ async *[Symbol.asyncIterator]() { yield await readFile(path); } });
  const shell = new Shell({ fs }).use(format === "docx"
    ? docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) })
    : pptxCommands({ engine: createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 32000000 }) }));
  return { shell, readFile, volume, publications, fs, readPublished, input: `/left.${format}`, right: `/right.${format}`, bad: `/bad.${format}`,
    run: (command: string, signal?: AbortSignal) => shell.exec(`${format} ${command}`, signal ? { signal } : {}) };
}

function envelope(stdout: string, operation: string, ok: boolean) {
  const value = JSON.parse(stdout);
  expect(Object.keys(value).sort()).toEqual(["version", "operation", "ok", "data", "warnings", "errors", "affected", "locations"].sort());
  expect(value).toMatchObject({ version: 1, operation, ok, warnings: expect.any(Array), errors: expect.any(Array), affected: expect.any(Number), locations: expect.any(Array) });
  if (!ok) expect(value).toMatchObject({ data: null, affected: 0, errors: [expect.objectContaining({ code: expect.any(String), message: expect.any(String) })] });
  return value;
}

describe.each(["docx", "pptx"] as const)("%s common public adapter", format => {
  it("uses common paths and read envelopes", async () => {
    const f = await fixture(format);
    try {
      for (const path of ["inspect", "text", "text get", "images list", "properties list", "capabilities"]) {
        const result = await f.run(`${path} ${f.input} --json`);
        expect(result.exitCode, `${path}: ${result.stderr} ${result.stdout}`).toBe(0);
        expect(envelope(result.stdout, path === "text" ? "text.get" : path.split(" ").join("."), true).affected).toBe(0);
      }
      for (const path of ["schema", "capabilities", "version", "help"]) {
        const result = await f.run(`${path} --json`);
        expect(result.exitCode, result.stderr).toBe(0);
        envelope(result.stdout, path, true);
      }
    } finally { await f.shell.dispose(); }
  });
  it("supports common validate", async () => {
    const f = await fixture(format);
    try {
      const result = await f.run(`validate ${f.input} --json`);
      expect(result.exitCode, result.stderr).toBe(0);
      envelope(result.stdout, "validate", true);
    } finally { await f.shell.dispose(); }
  });
  it("supports common tables list", async () => {
    const f = await fixture(format);
    try {
      const result = await f.run(`tables list ${f.input} --json`);
      expect(result.exitCode, result.stderr).toBe(0);
      envelope(result.stdout, "tables.list", true);
    } finally { await f.shell.dispose(); }
  });
  it("uses ordinary document, usage and I/O statuses", async () => {
    const f = await fixture(format);
    try {
      for (const [command, status] of [[`inspect ${f.bad}`, 1], [`inspect ${f.input} --unknown`, 2], [`inspect /missing.${format}`, 3], [`inspect /oversize.${format}`, 4]] as const) {
        const result = await f.run(`${command} --json`);
        expect(result.exitCode, result.stderr).toBe(status);
        envelope(result.stdout, "inspect", false);
      }
    } finally { await f.shell.dispose(); }
  });
  it("compares without requiring format-specific flags", async () => {
    const f = await fixture(format);
    try {
      for (const [right, status, equal] of [[f.input, 0, true], [f.right, 1, false], [f.bad, 2, null], [`/missing.${format}`, 2, null]] as const) {
        const result = await f.run(`diff ${f.input} ${right} --json`);
        expect(result.exitCode, result.stderr).toBe(status);
        const value = envelope(result.stdout, "diff", equal !== null);
        if (equal !== null) expect(value.data.equal).toBe(equal);
      }
    } finally { await f.shell.dispose(); }
  });
  it("uses equality, difference and trouble statuses with declared format scopes", async () => {
    const f = await fixture(format);
    const flags = format === "docx" ? "--mode text --scope body" : "--mode text";
    try {
      for (const [right, status, equal] of [[f.input, 0, true], [f.right, 1, false], [f.bad, 2, null], [`/missing.${format}`, 2, null]] as const) {
        const result = await f.run(`diff ${f.input} ${right} ${flags} --json`);
        expect(result.exitCode, result.stderr).toBe(status);
        const value = envelope(result.stdout, "diff", equal !== null);
        if (equal !== null) expect(value.data.equal).toBe(equal);
      }
      const invalid = await f.run(`diff ${f.input} ${f.right} ${flags} --output /out --json`);
      expect(invalid.exitCode).toBe(2);
      envelope(invalid.stdout, "diff", false);
    } finally { await f.shell.dispose(); }
  });
  it.each(["image list", "table list", "metadata list", "replace"])("rejects conflicting spelling %s", async path => {
    const f = await fixture(format);
    try {
      const result = await f.run(`${path} ${f.input} --json`);
      expect(result.exitCode).toBe(2);
      const value = JSON.parse(result.stdout);
      expect(value).toMatchObject({ version: 1, operation: "help", ok: false, data: null, affected: 0, warnings: [], locations: [], errors: [expect.objectContaining({ code: expect.any(String), message: expect.any(String) })] });
      expect(f.readFile).not.toHaveBeenCalled();
    } finally { await f.shell.dispose(); }
  });
  it.each(["--output /out", "--output-dir /out", "--in-place", "--force", "--dry-run", "--first", "--allow-empty", "--json", "--scope unknown"])("rejects inapplicable, repeated or invalid read flag %s", async flags => {
    const f = await fixture(format);
    try {
      const result = await f.run(`properties list ${f.input} ${flags} --json`);
      expect(result.exitCode, result.stderr).toBe(2);
      envelope(result.stdout, "properties.list", false);
      expect(f.readFile).not.toHaveBeenCalled();
    } finally { await f.shell.dispose(); }
  });
  it("uses public-engine comparison and ordinary cancellation status", async () => {
    const f = await fixture(format);
    try {
      for (const command of [`inspect ${f.input}`, `diff ${f.input} ${f.right}`]) {
        const controller = new AbortController();
        const stdout: Uint8Array[] = [];
        const args = [...command.split(" "), ...(format === "docx" && command.startsWith("diff") ? ["--scope", "package"] : []), "--json"].map(value => encoder.encode(value));
        const readInput = async (path: string) => { controller.abort(); return new Uint8Array(f.volume.readFileSync(path) as Buffer); };
        const result = format === "docx"
          ? { ...await createDocxInspectionCommandEngine({ limits }).execute({ args, signal: controller.signal, cwd: "/", filesystem: { readFile: readInput }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout.push(bytes); } }, stderr: { async write() {} } }), stdout: new Uint8Array(Buffer.concat(stdout)) }
          : await createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 65536 }).execute({ args, signal: controller.signal, readInput });
        expect(result.exitCode).toBe(130);
        if (result.stdout.length) envelope(new TextDecoder().decode(result.stdout), command.startsWith("diff") ? "diff" : "inspect", false);
      }
    } finally { await f.shell.dispose(); }
  });
  it("uses lowered comparison limits and rejects duplicate names", async () => {
    const f = await fixture(format);
    const limit = format === "docx" ? "compressedInput=1" : "maxBytes=1";
    const flags = format === "docx" ? "--scope package" : "";
    try {
      const comparison = await f.run(`diff ${f.input} ${f.right} ${flags} --limit ${limit} --json`);
      expect(comparison.exitCode, comparison.stderr).toBe(2);
      envelope(comparison.stdout, "diff", false);
      f.readFile.mockClear();
      for (const limits of [`--limit ${limit} --limit ${limit}`, "--limit unknown=1"]) {
        const invalid = await f.run(`diff ${f.input} ${f.right} ${flags} ${limits} --json`);
        expect(invalid.exitCode).toBe(2);
        envelope(invalid.stdout, "diff", false);
      }
      expect(f.readFile).not.toHaveBeenCalled();
    } finally { await f.shell.dispose(); }
  });
  it("uses direct text and property flags with dry-run envelopes", async () => {
    const f = await fixture(format);
    const before = f.volume.toJSON();
    try {
      for (const [command, operation] of [
        [`text replace ${f.input} --find Harbor --with Coastal --all`, "text.replace"],
        [`properties set ${f.input} --name title --value Coastal`, "properties.set"]
      ]) {
        const result = await f.run(`${command} --dry-run --json`);
        expect(result.exitCode, result.stderr + result.stdout).toBe(0);
        const value = envelope(result.stdout, operation!, true);
        expect(value.affected).toBe(1);
      }
      expect(f.volume.toJSON()).toEqual(before);
      for (const publish of f.publications) expect(publish).not.toHaveBeenCalled();
    } finally { await f.shell.dispose(); }
  });
  it("publishes pure package stdout with both output spellings", async () => {
    const f = await fixture(format);
    try {
      for (const output of ["--output", "-o"]) {
        const result = await f.run(`text replace ${f.input} --find Harbor --with Coastal --first ${output} -`);
        expect(result.exitCode, result.stderr).toBe(0);
        expect([...result.stdoutBytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
        const text = await f.shell.exec(`${format} text - --json`, { stdin: result.stdoutBytes });
        expect(text.exitCode, text.stderr).toBe(0);
        expect(envelope(text.stdout, "text.get", true).data.text).toContain("Coastal survey");
      }
      const invalid = await f.run(`text replace ${f.input} --find Harbor --with Coastal --first -o - --json`);
      expect(invalid.exitCode).toBe(2);
      envelope(invalid.stdout, "text.replace", false);
      const dry = await f.run(`text replace ${f.input} --find Harbor --with Coastal --first -o - --dry-run --json`);
      expect(dry.exitCode).toBe(0);
      envelope(dry.stdout, "text.replace", true);
    } finally { await f.shell.dispose(); }
  });
  it("keeps empty text mutations explicit", async () => {
    const f = await fixture(format);
    try {
      for (const [allow, status] of [["", 1], ["--allow-empty", 0]] as const) {
        const result = await f.run(`text replace ${f.input} --find Absent --with Coastal --all ${allow} --dry-run --json`);
        expect(result.exitCode, result.stderr + result.stdout).toBe(status);
        expect(envelope(result.stdout, "text.replace", status === 0).affected).toBe(0);
      }
    } finally { await f.shell.dispose(); }
  });
  it("extracts packages with admitted format output directories and common flags", async () => {
    const f = await fixture(format);
    try {
      if (format === "pptx") await f.fs.mkdir("/parts");
      const extract = await f.run(`extract ${f.input} --output-dir /parts --allow-partial-output --json`);
      expect(extract.exitCode, extract.stderr + extract.stdout).toBe(0);
      expect(envelope(extract.stdout, "extract", true).affected).toBe(0);
      const entries = await f.fs.readdir("/parts");
      expect(entries.length).toBeGreaterThan(0);
      if (format === "docx") expect(entries.map(entry => entry.name)).toContain("[Content_Types].xml");
    } finally { await f.shell.dispose(); }
  });
  it("replaces and extracts original image resources with common flags and envelopes", async () => {
    const f = await fixture(format, true);
    try {
      const list = await f.run(`images list ${f.input} --json`);
      expect(list.exitCode, list.stderr).toBe(0);
      expect(envelope(list.stdout, "images.list", true).affected).toBe(0);
      const replace = await f.run(`images replace ${f.input} ${format === "pptx" ? "--slide 1" : ""} --image 1 --file /pixel.gif --dry-run --json`);
      expect(replace.exitCode, replace.stderr + replace.stdout).toBe(0);
      expect(envelope(replace.stdout, "images.replace", true).affected).toBe(1);
      for (const publish of f.publications) expect(publish).not.toHaveBeenCalled();
      await f.fs.mkdir("/images");
      const extract = await f.run(`images extract ${f.input} --output-dir /images --allow-partial-output --json`);
      expect(extract.exitCode, extract.stderr + extract.stdout).toBe(0);
      expect(envelope(extract.stdout, "images.extract", true).affected).toBe(0);
      const files = (await f.fs.readdir("/images")).map(entry => entry.name).filter(name => !name.endsWith(".json"));
      expect(files).toHaveLength(1);
      expect(await f.readPublished(`/images/${files[0]}`)).toEqual(rasterPng());
    } finally { await f.shell.dispose(); }
  });
  it("declares every common operation path and excludes conflicting aliases", async () => {
    const f = await fixture(format);
    try {
      const result = await f.run("schema --json");
      expect(result.exitCode).toBe(0);
      const data = envelope(result.stdout, "schema", true).data;
      const operations = format === "docx" ? Object.fromEntries(data.operations.map((item: { id: string }) => [item.id, item])) : data.operations;
      for (const id of ["create", "inspect", "validate", "text.get", "text.replace", "xml.get", "xml.set", "template.apply", "batch", "diff", "extract", "pack", "sanitize", "images.list", "images.add", "images.replace", "images.extract", "tables.list", "properties.list", "properties.get", "properties.set", "properties.remove", "schema", "capabilities", "help", "version"]) {
        expect(Object.hasOwn(operations, id), id).toBe(true);
      }
      for (const id of Object.keys(operations)) {
        expect(["image", "table", "metadata", "replace"]).not.toContain(id.split(".")[0]);
      }
      expect(f.readFile).not.toHaveBeenCalled();
    } finally { await f.shell.dispose(); }
  });
  it("declares common replacement options and result fields through public schema", async () => {
    const f = await fixture(format);
    try {
      const result = await f.run("schema text replace --json");
      expect(result.exitCode, result.stderr).toBe(0);
      const data = envelope(result.stdout, "schema", true).data;
      const operation = format === "docx" ? data.operations[0] : data.operations["text.replace"];
      const input = format === "docx" ? operation.input : operation.options;
      expect(input.additionalProperties).toBe(false);
      expect(input.required).toEqual(expect.arrayContaining(["find", "with"]));
      for (const name of ["find", "with", "first", "all", "occurrence", "json", "output", "inPlace", "force", "dryRun", "allowEmpty", "select", "scope", "limit"]) expect(input.properties, name).toHaveProperty(name);
      for (const branch of operation.result.oneOf ?? [operation.result]) {
        for (const name of ["version", "operation", "ok", "data", "warnings", "errors", "affected", "locations"]) expect(branch.properties, name).toHaveProperty(name);
      }
    } finally { await f.shell.dispose(); }
  });
  it("rejects conflicting cardinalities and unknown replacement flags before I/O", async () => {
    const f = await fixture(format);
    try {
      for (const flags of ["--first --all", "--occurrence 0", "--first --unknown", "--first --first", "--first --in-place --output /out", "--first --force"]) {
        const result = await f.run(`text replace ${f.input} --find Harbor --with Coastal ${flags} --dry-run --json`);
        expect(result.exitCode, result.stderr + result.stdout).toBe(2);
        envelope(result.stdout, "text.replace", false);
      }
      expect(f.readFile).not.toHaveBeenCalled();
    } finally { await f.shell.dispose(); }
  });
});
