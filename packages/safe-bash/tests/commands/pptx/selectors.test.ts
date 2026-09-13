import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, createPresentation, mutateSlides, readPresentationText, readSelectionIndex } from "pptx";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { FsError, toByteSource, type FileSystem, type PluginHost } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { createPptxCommands, pptxCommands } from "../../../src/commands/pptx/index.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 8192, maxTotalBytes: 32768, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 8192, chunkSize: 512 },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
  validationLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32, maxParts: 32, maxRelationships: 64, maxEntries: 32 },
};

function deck(reversed = false) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const relations = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const link = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const slide = (name: string) => `<p:sld xmlns:p="${p}"><p:cSld name="${name}"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="7" name="heading"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="8" name="heading"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="9" name="7"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>`;
  const ordered = reversed ? '<p:sldId id="900" r:id="b"/><p:sldId id="400" r:id="a"/>' : '<p:sldId id="400" r:id="a"/><p:sldId id="900" r:id="b"/>';
  return storedArchive(Object.entries({
    "ppt/slides/slide1.xml": slide("Meadow"),
    "ppt/slides/slide99.xml": slide("Meadow"),
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide99.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    "_rels/.rels": relations(link("root", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst>${ordered}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relations(link("a", "slide", "slides/slide99.xml") + link("b", "slide", "slides/slide1.xml")),
  }).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })));
}

function fixture(register = true) {
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/deck.pptx", deck());
  volume.writeFileSync("/work/-deck.pptx", deck());
  volume.writeFileSync("/work/\uFEFFdeck.pptx", deck(true));
  volume.writeFileSync("/work/inspect.sh", "pptx inspect deck.pptx --slide 2 --json\n");
  const fs: FileSystem = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async path => {
    try {
      const stat = volume.statSync(path);
      return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs), identityScope, dev: Number(stat.dev), ino: Number(stat.ino), revision: Number(stat.mtimeMs), nlink: Number(stat.nlink) };
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = async path => {
    const observed = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...observed, type: "symlink" } : observed;
  };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.lstat(path) : null;
    if (current?.ino !== options.expected?.ino || current?.size !== options.expected?.size || current?.revision !== options.expected?.revision) throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  fs.access = async (path, mode) => {
    try { volume.accessSync(path, mode); } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    try {
      const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
      if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) throw new FsError("EFBIG");
      return bytes;
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" });
  if (register) shell.use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 }) }));
  return { shell, volume, fs };
}

for (const link of ["hardlink", "symlink"]) test(`pptx publication protects secondary input ${link} aliases`, async () => {
  const { shell, volume, fs } = fixture(false);
  fs.readlink = async path => String(volume.readlinkSync(path));
  fs.realpath = async path => String(volume.realpathSync(path));
  const source = new Uint8Array([7, 8, 9]);
  volume.writeFileSync("/work/source.pptx", source);
  volume.linkSync("/work/source.pptx", "/work/alias.pptx");
  if (link === "symlink") volume.symlinkSync("/work/source.pptx", "/work/source-link.pptx");
  let failure: unknown;
  shell.use(pptxCommands({ engine: { async execute(request) {
    const original = await request.readInput("deck.pptx", 65536);
    await request.readInput(link === "symlink" ? "source-link.pptx" : "source.pptx", 65536);
    try {
      await request.publishOutput!({ inputPath: "deck.pptx", outputPath: "alias.pptx",
        originalBytes: original, bytes: new Uint8Array([1]), inPlace: false, force: true, dryRun: false });
    } catch (error) { failure = error; }
    return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
  } } }));
  const result = await shell.exec("pptx");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal((failure as { code?: string } | undefined)?.code, "io-failure");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer), source);
});

test("pptx adapter publishes atomically and refuses alias, stale and unavailable destinations", async () => {
  for (const scenario of ["new", "existing", "force", "alias", "hardlink", "symlink", "unknown", "stale", "unsupported", "dry-run", "dry-alias", "race"]) {
    const { shell, volume, fs } = fixture(false);
    const original = deck();
    const output = new Uint8Array([21, 34, 55]);
    if (["existing", "force", "unknown"].includes(scenario)) volume.writeFileSync("/work/out.pptx", "old");
    if (scenario === "hardlink") volume.linkSync("/work/deck.pptx", "/work/out.pptx");
    if (scenario === "symlink") volume.symlinkSync("/work/deck.pptx", "/work/out.pptx");
    if (scenario === "unknown") {
      const stat = fs.stat;
      fs.stat = fs.lstat = async path => {
        const observed = await stat(path);
        return { type: observed.type, size: observed.size, mode: observed.mode, atimeMs: observed.atimeMs, mtimeMs: observed.mtimeMs, ctimeMs: observed.ctimeMs };
      };
      fs.compareEntry = async () => "unknown";
    }
    if (scenario === "unsupported") fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileMutation: false });
    if (scenario === "race") fs.writeFileConditional = async () => { throw new FsError("EAGAIN"); };
    let failure: unknown;
    shell.use(pptxCommands({ engine: { async execute(request) {
      await request.readInput("deck.pptx", 65536);
      if (scenario === "stale") volume.writeFileSync("/work/deck.pptx", "changed");
      try {
        assert.equal(typeof request.publishOutput, "function");
        await request.publishOutput!({ inputPath: "deck.pptx", outputPath: ["alias", "stale", "dry-alias"].includes(scenario) ? "deck.pptx" : "out.pptx", originalBytes: original, bytes: output, inPlace: scenario === "stale", force: ["force", "hardlink", "unknown"].includes(scenario), dryRun: ["dry-run", "dry-alias"].includes(scenario) });
      } catch (error) { failure = error; }
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    } } }));
    await shell.exec("pptx");
    if (["new", "force", "dry-run"].includes(scenario)) assert.equal(failure, undefined, scenario);
    else assert.equal((failure as { code?: string })?.code, ["stale", "race"].includes(scenario) ? "stale-input" : scenario === "unsupported" ? "publication-unsupported" : "io-failure", scenario);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), scenario === "stale" ? new TextEncoder().encode("changed") : original, scenario);
    if (["new", "force"].includes(scenario)) assert.deepEqual(new Uint8Array(volume.readFileSync("/work/out.pptx") as Buffer), output);
    else if (["existing", "unknown"].includes(scenario)) assert.equal(volume.readFileSync("/work/out.pptx", "utf8"), "old");
    else if (!["hardlink", "symlink"].includes(scenario)) assert.equal(volume.existsSync("/work/out.pptx"), false, scenario);
  }
});

test("pptx XML commands read original bytes and validate before virtual file publication", async () => {
  const namespace = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const originalXml = `<?xml version="1.0"?><show:presentation xmlns:show="${namespace}">\n<show:notesSz cx="5000000" cy="9000000"/>\n</show:presentation>`;
  const changedXml = `<show:presentation xmlns:show="${namespace}"><show:notesSz cx="6000000" cy="8000000"/></show:presentation>`;
  const original = storedArchive(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/show.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="entry" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="show.xml"/></Relationships>',
    "show.xml": originalXml
  }).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })));
  for (const scenario of ["new", "in-place", "dry-run", "invalid", "unsupported", "alias", "exists", "force", "race", "dry-readonly", "dry-write-disabled", "readonly", "write-disabled"]) {
    const { shell, volume, fs } = fixture();
    volume.writeFileSync("/work/deck.pptx", original);
    volume.writeFileSync("/work/change.xml", scenario === "invalid" ? "<broken>" : changedXml);
    if (["invalid", "unsupported", "exists", "force"].includes(scenario)) volume.writeFileSync("/work/out.pptx", "keep");
    if (scenario === "unsupported") fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileMutation: false });
    if (["dry-readonly", "readonly"].includes(scenario)) fs.capabilitiesFor = async () => ({ ...fs.capabilities, readOnly: true });
    if (["dry-write-disabled", "write-disabled"].includes(scenario)) fs.capabilitiesFor = async () => ({ ...fs.capabilities, write: false });
    if (scenario === "race") fs.writeFileConditional = async () => { throw new FsError("EAGAIN"); };
    const read = await shell.exec("pptx xml get deck.pptx --part /show.xml --scope presentation");
    assert.equal(read.exitCode, 0, read.stderr);
    assert.equal(read.stdout, originalXml);
    const pretty = await shell.exec("pptx xml get deck.pptx --part /show.xml --scope presentation --pretty");
    assert.equal(pretty.exitCode, 0, pretty.stderr);
    assert.ok(pretty.stdout.startsWith("Pretty XML (not original bytes)"));
    const flags = scenario === "in-place" ? "--in-place" : `--output ${scenario === "alias" ? "./deck.pptx" : "out.pptx"}${["force", "invalid", "unsupported", "alias"].includes(scenario) ? " --force" : ""}${["dry-run", "dry-readonly", "dry-write-disabled"].includes(scenario) ? " --dry-run" : ""}`;
    const result = await shell.exec(`pptx xml set deck.pptx --part /show.xml --scope presentation --file change.xml ${flags} --json`);
    const envelope = JSON.parse(result.stdout);
    const success = ["new", "in-place", "dry-run", "force"].includes(scenario);
    assert.equal(result.exitCode, success ? 0 : ["invalid", "race", "unsupported", "dry-readonly", "dry-write-disabled", "readonly", "write-disabled"].includes(scenario) ? 1 : 3, `${scenario}: ${result.stdout}`);
    assert.equal(envelope.ok, success, scenario);
    assert.equal(envelope.affected, success ? 1 : 0, scenario);
    assert.equal(result.stderr, "");
    if (scenario !== "in-place") assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
    if (["new", "in-place", "force"].includes(scenario)) {
      const output = scenario === "in-place" ? "deck.pptx" : "out.pptx";
      const verified = await shell.exec(`pptx xml get ${output} --part /show.xml --scope presentation`);
      assert.equal(verified.exitCode, 0, verified.stderr);
      assert.equal(verified.stdout, changedXml);
    } else if (["invalid", "unsupported", "exists"].includes(scenario)) assert.equal(volume.readFileSync("/work/out.pptx", "utf8"), "keep");
    else assert.equal(volume.existsSync("/work/out.pptx"), false);
  }
});

test("pptx validates empty input and preserves output mode and operation on grammar failures", async () => {
  const { shell, fs } = fixture();
  fs.readFile = async () => { assert.fail("invalid grammar must not read input"); };
  fs.readStream = () => { assert.fail("invalid grammar must not stream input"); };
  for (const [command, operation] of [["schema", "schema"], ["capabilities", "capabilities"], ["help", "help"], ["version", "version"], ["-h", "help"], ["--help", "help"], ["--version", "version"]]) {
    const result = await shell.exec(`pptx ${command} --unknown --json`);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      version: 1, operation, ok: false, data: null, warnings: [],
      errors: [{ code: "invalid-value", message: "Unsupported option.", context: { phase: "usage" } }],
      affected: 0, locations: []
    });
  }
  const empty = await shell.exec("pptx inspect '' --json");
  assert.equal(empty.exitCode, 2);
  assert.equal(empty.stderr, "");
  assert.equal(JSON.parse(empty.stdout).errors[0].code, "invalid-value");
  const literal = await shell.exec("pptx inspect --unknown -- --json");
  assert.equal(literal.exitCode, 2);
  assert.equal(literal.stdout, "");
  assert.equal(literal.stderr, "pptx: invalid-value: Unsupported option.\n");
  for (const json of [false, true]) {
    const value = await shell.exec(`pptx inspect deck.pptx --slide 1 --shape --json --unknown${json ? " --json" : ""}`);
    assert.equal(value.exitCode, 2);
    if (json) {
      assert.equal(value.stderr, "");
      assert.equal(JSON.parse(value.stdout).ok, false);
    } else {
      assert.equal(value.stdout, "");
      assert.equal(value.stderr, "pptx: invalid-value: Unsupported option.\n");
    }
  }
});

test("pptx preserves explicit output mode when shell arguments contain invalid UTF-8", async () => {
  const { shell } = fixture();
  for (const terminated of [false, true]) {
    const result = await shell.exec(`pptx schema $'\\xff' ${terminated ? "-- " : ""}--json`);
    assert.equal(result.exitCode, 2);
    if (terminated) {
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "pptx: invalid-value: Arguments must be UTF-8.\n");
    } else {
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.operation, "schema");
      assert.equal(envelope.errors[0].message, "Arguments must be UTF-8.");
    }
  }
});

test("pptx reads a streaming-only file using path-specific capabilities", async () => {
  const { shell, fs } = fixture();
  const queried: string[] = [];
  fs.capabilitiesFor = async (path, options) => {
    assert.equal(options?.signal?.aborted, false);
    queried.push(path);
    return { ...fs.capabilities, read: false, streamingRead: true };
  };
  fs.readFile = async () => { assert.fail("buffered reads are unavailable"); };
  const result = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "400");
  assert.ok(queried.includes("/work/deck.pptx"));
});

test("pptx refuses unavailable file reads before accessing content", async () => {
  const { shell, fs } = fixture();
  let reads = 0;
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, read: false, streamingRead: false });
  fs.readFile = async () => { reads++; return deck(); };
  fs.readStream = async function* () { reads++; yield deck(); };
  const result = await shell.exec("pptx inspect deck.pptx --json");
  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "io-failure");
  assert.equal(reads, 0);
  assert.equal((await shell.exec("pptx inspect - --slide 1 --json", { stdin: toByteSource(deck()) })).exitCode, 0);
});

test("pptx reads buffered files without entering a disabled stream", async () => {
  const { shell, fs } = fixture();
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  fs.readStream = () => { assert.fail("streaming reads are unavailable"); };
  const result = await shell.exec("pptx inspect deck.pptx --slide 2 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "900");
});

test("pptx collision preflight does not call registration", () => {
  const plugin = pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 }) });
  let registrations = 0;
  const host = { commands: { has: (name: string) => name === "pptx", register: () => { registrations++; } } } as unknown as PluginHost;
  assert.throws(() => plugin.setup(host), { message: "Command already registered: pptx" });
  assert.equal(registrations, 0);
});

for (const replace of ["false", 1, null]) {
  test(`pptx rejects invalid replacement configuration ${JSON.stringify(replace)}`, () => {
    const engine = createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 });
    const options = { engine, replace: replace as unknown as boolean };
    for (const factory of [createPptxCommands, pptxCommands]) {
      assert.throws(() => factory(options), { name: "TypeError", message: "pptx replace must be boolean" });
    }
  });
}

test("pptx registration is opt-in, reusable across shells and replaceable only explicitly", async () => {
  const { shell } = fixture(false);
  assert.equal(shell.commands.has("pptx"), false);
  assert.equal((await shell.exec("pptx --help")).exitCode, 127);
  const engine = createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 });
  const plugin = pptxCommands({ engine });
  shell.use(plugin);
  const other = fixture(false).shell.use(plugin);
  assert.equal((await other.exec("pptx schema inspect --json")).exitCode, 0);
  other.use(pptxCommands({ engine }));
  await assert.rejects(other.exec("pptx --help"), { message: "Command already registered: pptx" });
  assert.equal((await shell.exec("pptx --help")).exitCode, 0);
  shell.use(pptxCommands({ engine, replace: true }));
  assert.equal((await shell.exec("pptx inspect deck.pptx --slide 1 --json")).exitCode, 0);
});

test("pptx accepts quoted Unicode paths and byte pipelines in a virtual script", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/coast '$ τ.pptx", deck());
  volume.writeFileSync("/work/quoted script.sh", `pptx inspect --slide 1 --json -- "coast '\\$ τ.pptx"\npptx inspect - --slide 2 --json | pptx schema inspect --json\n`);
  const script = await shell.exec("sh 'quoted script.sh'", { stdin: toByteSource(deck()) });
  assert.equal(script.exitCode, 0, script.stderr);
  const [inspection, schema] = script.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(inspection.data.records[0].id, "400");
  assert.equal(schema.operation, "schema");
  shell.commands.register({ name: "deck_bytes", async execute(command) {
    const bytes = deck();
    await command.stdout.write(bytes.subarray(0, 79));
    await command.stdout.write(bytes.subarray(79));
    return { exitCode: 0 };
  } });
  const piped = await shell.exec("deck_bytes | pptx inspect - --slide 2 --json");
  assert.equal(piped.exitCode, 0, piped.stderr);
  assert.equal(JSON.parse(piped.stdout).data.records[0].id, "900");
});

test("pptx bounds streaming and buffered file inputs independently of provider enforcement", async () => {
  for (const streamingRead of [false, true]) {
    const { shell, fs } = fixture();
    fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead });
    fs.readFile = async () => new Uint8Array(65537);
    fs.readStream = async function* () { yield new Uint8Array(65537); };
    const result = await shell.exec("pptx inspect deck.pptx --json");
    assert.equal(result.exitCode, 4);
    assert.equal(JSON.parse(result.stdout).errors[0].code, "resource-limit");
  }
});

test("pptx falls back only when streaming is unavailable before content", async () => {
  for (const phase of ["acquisition", "empty", "partial"]) {
    const { shell, fs } = fixture();
    let reads = 0;
    fs.readStream = phase === "acquisition"
      ? () => { throw new FsError("ENOTSUP"); }
      : async function* () {
        if (phase === "partial") yield deck().subarray(0, 10);
        throw new FsError("ENOTSUP");
      };
    fs.readFile = async () => { reads++; return deck(); };
    const result = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
    assert.equal(result.exitCode, phase === "partial" ? 3 : 0, result.stderr);
    assert.equal(reads, phase === "partial" ? 0 : 1);
  }
});

test("pptx direct command contexts handle synchronous unavailable stream acquisition", async () => {
  const { shell, fs } = fixture();
  fs.readStream = () => { throw new FsError("ENOTSUP"); };
  const command = createPptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 }) })[0]!;
  shell.use((invocation) => command.execute({ ...invocation, fs }));
  const result = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "400");
});

test("pptx preserves producer-reused file stream chunks", async () => {
  const { shell, fs } = fixture();
  fs.readStream = async function* () {
    const bytes = deck();
    const chunk = new Uint8Array(31);
    for (let offset = 0; offset < bytes.length; offset += chunk.length) {
      const length = Math.min(chunk.length, bytes.length - offset);
      chunk.set(bytes.subarray(offset, offset + length));
      yield chunk.subarray(0, length);
    }
    chunk.fill(0);
  };
  const result = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "400");
});

test("pptx forwards cancellation to file acquisition and closes its stream", async () => {
  const { shell, fs } = fixture();
  const controller = new AbortController();
  const reason = new Error("stop reading");
  let observed: AbortSignal | undefined;
  let closed = false;
  fs.readStream = async function* (_path, options) {
    observed = options?.signal;
    try {
      yield deck().subarray(0, 20);
      controller.abort(reason);
      options?.signal?.throwIfAborted();
    } finally { closed = true; }
  };
  await assert.rejects(shell.exec("pptx inspect deck.pptx --json", { signal: controller.signal }), error => error === reason);
  assert.equal(observed?.aborted, true);
  assert.equal(closed, true);
});

test("pptx observes cancellation after capabilities resolve before reading content", async () => {
  const { shell, fs } = fixture();
  const controller = new AbortController();
  const reason = new Error("stop admission");
  let reads = 0;
  fs.capabilitiesFor = async () => {
    controller.abort(reason);
    return fs.capabilities;
  };
  fs.readFile = async () => { reads++; return deck(); };
  fs.readStream = async function* () { reads++; yield deck(); };
  await assert.rejects(shell.exec("pptx inspect deck.pptx --json", { signal: controller.signal }), error => error === reason);
  assert.equal(reads, 0);
});

test("pptx inspection follows slide order with the same identity through SDK and CLI", async () => {
  const { shell } = fixture();
  const output = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
  assert.equal(output.exitCode, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.equal(result.version, 1);
  assert.equal(result.operation, "inspect");
  assert.equal(result.affected, 0);
  assert.equal(result.data.records[0].id, "400");
  assert.equal(result.data.records[0].part, "/ppt/slides/slide99.xml");
  const index = await readSelectionIndex(deck(), context);
  assert.deepEqual(result.locations, index.select({ kind: "slide", position: { coordinateSystem: "one-based", value: 1 } }).map(record => record.location));
});

test("pptx human inspection shows ordered names and owning identities", async () => {
  const result = await fixture().shell.exec("pptx inspect deck.pptx --slide 1");
  assert.equal(result.stdout, 'slide 1 "Meadow" id="400" owner="/ppt/slides/slide99.xml"\n');
  assert.equal(result.stderr, "");
});

test("pptx scopes duplicate object names to a slide and requires explicit all", async () => {
  const { shell } = fixture();
  const ambiguous = await shell.exec("pptx inspect deck.pptx --slide 1 --shape heading --json");
  assert.equal(ambiguous.exitCode, 1);
  assert.equal(JSON.parse(ambiguous.stdout).errors[0].code, "ambiguous-selection");
  const selected = await shell.exec("pptx inspect deck.pptx --slide 1 --shape heading --all --json");
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout).data.records.map((record: { id: string }) => record.id), ["7", "8"]);
});

test("pptx rejects stale tokens and preserves IDs after reorder", async () => {
  const { shell, volume } = fixture();
  const initial = JSON.parse((await shell.exec("pptx inspect deck.pptx --slide 1 --json")).stdout);
  const token = initial.data.records[0].token;
  assert.equal((await shell.exec(`pptx inspect deck.pptx --select '${token}' --json`)).exitCode, 0);
  volume.writeFileSync("/work/deck.pptx", deck(true));
  const stale = await shell.exec(`pptx inspect deck.pptx --select '${token}' --json`);
  assert.equal(stale.exitCode, 1);
  assert.equal(JSON.parse(stale.stdout).errors[0].code, "stale-selection");
  const moved = JSON.parse((await shell.exec("pptx inspect deck.pptx --slide 2 --json")).stdout);
  assert.equal(moved.data.records[0].id, "400");
});

test("pptx discovery is explicit and reports the narrow read profile", async () => {
  const { shell } = fixture();
  const schema = await shell.exec("pptx schema inspect --json");
  assert.equal(schema.exitCode, 0, schema.stderr);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.options.properties.slide.minimum, 1);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.options.additionalProperties, false);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.result.properties.version.const, 1);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.selectionQuery.additionalProperties, false);
  const capabilities = JSON.parse((await shell.exec("pptx capabilities --json")).stdout);
  assert.equal(capabilities.data.features.selectors.level, "read");
  assert.equal(capabilities.data.features.editing.level, "reject");
  assert.ok((await shell.exec("pptx --help")).stdout.includes("--slide N"));
});

test("pptx reports output admission failure as a bounded JSON result", async () => {
  const { shell } = fixture();
  shell.use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 512, maxArgumentBytes: 8192 }), replace: true }));
  const result = await shell.exec("pptx inspect deck.pptx --json");
  assert.equal(result.exitCode, 4);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.data, null);
  assert.equal(body.errors[0].code, "resource-limit");
  assert.ok(new TextEncoder().encode(result.stdout).length <= 512);
});

for (const args of ["--slide 0", "--slide -1", "--slide 1.5", "--slide 1 --slide 2", "--shape heading", "--scope nowhere", "--output out.pptx", "--select x --slide 1", "--all --all"]) {
  test(`pptx rejects invalid inspection arguments ${args}`, async () => {
    const result = await fixture().shell.exec(`pptx inspect deck.pptx ${args} --json`);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, false);
  });
}

test("pptx separates missing selections, missing files and option-terminated paths", async () => {
  const { shell } = fixture();
  assert.equal((await shell.exec("pptx inspect deck.pptx --slide 3 --json")).exitCode, 1);
  assert.equal((await shell.exec("pptx inspect absent.pptx --json")).exitCode, 3);
  assert.equal((await shell.exec("pptx inspect --json -- -deck.pptx")).exitCode, 0);
});

test("pptx treats numeric shape strings as names within the owning slide", async () => {
  const result = await fixture().shell.exec("pptx inspect deck.pptx --slide 2 --shape 7 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "9");
  assert.equal(JSON.parse(result.stdout).data.records[0].part, "/ppt/slides/slide1.xml");
});

test("pptx classifies malformed location tokens as usage failures", async () => {
  const result = await fixture().shell.exec("pptx inspect deck.pptx --select malformed --json");
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "invalid-selection");
  const absent = await fixture().shell.exec("pptx inspect absent.pptx --select malformed --json");
  assert.equal(absent.exitCode, 2);
  assert.equal(JSON.parse(absent.stdout).errors[0].code, "invalid-selection");
});

test("pptx rejects malformed part selectors before attempting file reads", async () => {
  const result = await fixture().shell.exec("pptx inspect absent.pptx --part ../outside.xml --json");
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "invalid-selection");
});

test("pptx preserves an initial byte-order character in a literal filename", async () => {
  const result = await fixture().shell.exec("pptx inspect '\uFEFFdeck.pptx' --slide 1 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "900");
});

test("pptx accepts bounded stdin and virtual script workflows", async () => {
  const { shell } = fixture();
  const input = await shell.exec("pptx inspect - --slide 1 --json", { stdin: toByteSource(deck()) });
  assert.equal(input.exitCode, 0, input.stderr);
  assert.equal(JSON.parse(input.stdout).data.records[0].id, "400");
  const script = await shell.exec("sh inspect.sh");
  assert.equal(script.exitCode, 0, script.stderr);
  assert.equal(JSON.parse(script.stdout).data.records[0].id, "900");
  const over = await shell.exec("pptx inspect - --json", { stdin: toByteSource(new Uint8Array(65537)) });
  assert.equal(over.exitCode, 4);
  assert.equal(JSON.parse(over.stdout).errors[0].code, "resource-limit");
});


test("pptx text reads Unicode, empty bodies and hidden slides through the registered command", async () => {
  const { shell, volume } = fixture();
  const created = await createPresentation({ slides: [
    { shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "雪 café\nNext paragraph" }, { name: "Empty", x: 0, y: 0, width: 100, height: 100, text: "" }] },
    { shapes: [{ name: "Hidden caption", x: 0, y: 0, width: 100, height: 100, text: "Hidden content" }] }
  ] }, context);
  const source = await mutateSlides(created, { selection: {kind: "slide", position: {coordinateSystem: "one-based", value: 2}}, hidden: true }, context);
  volume.writeFileSync("/work/text.pptx", source);
  const result = await shell.exec("pptx text get text.pptx --json");
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout).data;
  assert.equal(data.text, "雪 café\nNext paragraph\n\nHidden content");
  assert.equal(data.order, "structural");
  assert.deepEqual(data.segments.map((segment: {text: string}) => segment.text), ["雪 café\nNext paragraph", "", "Hidden content"]);
  assert.deepEqual(data, await readPresentationText(source, {}, context));
  const stdin = await shell.exec("pptx text get - --json", {stdin: toByteSource(source)});
  assert.equal(stdin.exitCode, 0, stdin.stdout);
  assert.deepEqual(JSON.parse(stdin.stdout).data, data);
  const selected = await shell.exec("pptx text text.pptx --slide 1 --shape Caption");
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.equal(selected.stdout, "雪 café\nNext paragraph");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/text.pptx") as Buffer), source);
});

test("pptx text replacement runs in a VFS script with explicit match and publication controls", async () => {
  const { shell, volume } = fixture();
  const input = await createPresentation({ slides: [{ shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "雪 café 雪" }] }] }, context);
  volume.writeFileSync("/work/input.pptx", input);
  volume.writeFileSync("/work/replace.sh", "pptx text replace input.pptx --find '雪' --with '海 breeze' --first --output edited.pptx --json\npptx text edited.pptx\n");
  const edited = await shell.exec("sh replace.sh");
  assert.equal(edited.exitCode, 0, edited.stdout + edited.stderr);
  assert.equal(edited.stdout.split("\n")[1], "海 breeze café 雪");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/input.pptx") as Buffer), input);
  const conflict = await shell.exec("pptx text replace input.pptx --find '雪' --with '' --all --output edited.pptx --json");
  assert.equal(conflict.exitCode, 3, conflict.stdout + conflict.stderr);
  const outputBefore = new Uint8Array(volume.readFileSync("/work/edited.pptx") as Buffer);
  const dry = await shell.exec("pptx text replace edited.pptx --find '雪' --with '' --all --in-place --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/edited.pptx") as Buffer), outputBefore);
  const missing = await shell.exec("pptx text replace edited.pptx --find absent --with '' --all --in-place --json");
  assert.equal(missing.exitCode, 1, missing.stdout + missing.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/edited.pptx") as Buffer), outputBefore);
  const inplace = await shell.exec("pptx text replace edited.pptx --find '雪' --with '' --all --in-place --json");
  assert.equal(inplace.exitCode, 0, inplace.stdout + inplace.stderr);
  assert.equal((await readPresentationText(new Uint8Array(volume.readFileSync("/work/edited.pptx") as Buffer), {}, context)).text, "海 breeze café ");
});
