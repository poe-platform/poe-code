import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createVfsOutput, type PublicationFileSystem } from "../io/publication.js";
import { createEngine, createResourceIO, runCommand, type CapabilityContext, type Cleanup, type Codec, type EngineConfig } from "../index.js";

function publication() {
  const volume = Volume.fromJSON({ "/in.csv": "original", "/out.csv": "keep" });
  const cleanups: Cleanup[] = [];
  const events: string[] = [];
  const controller = new AbortController();
  const context: CapabilityContext = {
    signal: controller.signal, environment: { env: { PWD: "/" }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 10, operations: 10 },
    own(cleanup) { events.push("own"); cleanups.push(cleanup); }
  };
  const fs: PublicationFileSystem = {
    capabilities: { exclusiveCreate: true, atomicRename: true, permissions: true },
    async lstat(path) {
      events.push(`stat ${path}`);
      const stat = volume.lstatSync(path);
      return { type: stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "directory", mode: stat.mode };
    },
    async access(path, mode) { volume.accessSync(path, mode); },
    async readlink(path) { return volume.readlinkSync(path) as string; },
    async writeFile(path, bytes, options) {
      events.push(`create ${path}`);
      volume.writeFileSync(path, bytes, {
        ...(options?.flag === undefined ? {} : { flag: options.flag }),
        ...(options?.mode === undefined ? {} : { mode: options.mode })
      });
    },
    async rename(source, destination) { events.push("rename"); volume.renameSync(source, destination); },
    async unlink(path) { events.push("unlink"); volume.unlinkSync(path); },
    async chmod(path, mode) { events.push("chmod"); volume.chmodSync(path, mode); }
  };
  const writeBytes = async (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); };
  return { volume, fs, context, controller, cleanups, events, writeBytes };
}

function splitFixture(outputBytes = 100) {
  const fixture = publication();
  const { volume, fs, context, writeBytes } = fixture;
  const codec: Codec = { id: "original", description: "Original", extensions: ["csv"], saveScope: "sheet",
    probeName: () => true, probeContent: () => true,
    async read() { return { sheets: ["One", "Two", "Three"].map((name) => ({ id: name, name, cells: [] })) }; },
    async write(book) { return new TextEncoder().encode(book.sheets[0]!.name); }
  };
  const config: EngineConfig = { codecs: [codec], environment: context.environment,
    limits: { ...context.limits, outputBytes }, filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }, openOutput: createVfsOutput(fs, writeBytes)
    } }) };
  return { ...fixture, config };
}
const operation = () => ({ signal: new AbortController().signal });

describe("independent conversion lifecycle stress", () => {
  it.each([
    ["file:///nested/../in.csv?ignored", "file:///in.csv"],
    ["file://localhost/in.csv#ignored", "file:///in.csv"],
    ["file:///space%20name.data", "file:///space%20name.csv"],
    ["file:///dotless", "file:///dotlesscsv"]
  ])("uses the same canonical inferred output for SDK and CLI: %s", async (input, output) => {
    const { config, volume } = splitFixture();
    volume.writeFileSync("/space name.data", "original");
    volume.writeFileSync("/dotless", "original");
    const engine = createEngine(config);
    const sdk = await engine.convert({ input: { kind: "resource", uri: input }, exportType: "original" }, operation());
    expect(sdk.artifacts).toEqual([{ uri: output, bytes: 3 }]);
    const diagnostics: string[] = [];
    const cli = await runCommand(["-T", "original", input], engine, { ...operation(),
      stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new TextDecoder().decode(bytes)); } } });
    expect(cli).toMatchObject({ exitCode: 0, artifacts: [{ uri: output, bytes: 3 }] });
    expect(diagnostics).toEqual([]);
  });

  it("rejects unknown extensions before an invalid importer or missing input without acquisition", async () => {
    const { config, events, volume } = splitFixture();
    await expect(createEngine(config).convert({ input: { kind: "resource", uri: "/absent" },
      destination: { kind: "resource", uri: "/unknown.zzz" }, importType: "absent", solve: true }, operation()))
      .rejects.toMatchObject({ exitCode: 2, message: "Unable to guess exporter to use for 'file:///unknown.zzz'.\nTry --list-exporters to see a list of possibilities." });
    expect(events).toEqual([]);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("keeps goal, solve, tool diagnostics, reverse resize, and both recalc stages before range failure", async () => {
    const { config, volume } = splitFixture();
    const events: string[] = [];
    const codec: Codec = { ...config.codecs[0]!, async exportOptions(options) { events.push("options"); return options; } };
    const engine = createEngine({ ...config, codecs: [codec], solver: {
      async goalSeek(book) { events.push("goal"); return book; },
      async solve(book) { events.push("solve"); return book; }
    }, analysis: { async analyze(book, request) {
      events.push("tool");
      expect(request.tool).toBe("moving-average");
      expect(request.properties).toEqual([{ name: "x", value: "last:tail" }]);
      return book;
    } }, resize: { async resizeSheet(book, id, size) {
      events.push(`resize:${id}`);
      expect(size).toEqual({ rows: 128, columns: 256 });
      return id === "Two" ? undefined : book;
    } }, formulas: { async recalculate(book) { events.push("recalc"); return book; } } });
    const range = { sheet: "One", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    await expect(engine.convert({ input: { kind: "resource", uri: "/in.csv" },
      destination: { kind: "resource", uri: "/out.csv" }, goalSeek: [{ target: range, variable: range, value: 1 }],
      solve: true, toolTest: ["moving-average", "x:first", "invalid", "x:last:tail"],
      resizeExpression: "128x256tail", recalc: true, exportRangeExpression: "missing!A1" }, {
      ...operation(), async diagnostic(value) { events.push(value.message); }
    })).rejects.toMatchObject({ message: "Invalid range specified." });
    expect(events).toEqual(["recalc", "options", "goal", "solve", 'Ignoring tool test argument "invalid"', "tool",
      "resize:Three", "resize:Two", "Resizing of sheet Two failed", "resize:One", "recalc", "recalc"]);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("keep");
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("closes acquisition when ownership cleanup starts before the first filesystem call", async () => {
    const { fs, context, writeBytes, events, volume } = publication();
    let closing: void | Promise<void>;
    const opening = createVfsOutput(fs, writeBytes)("/out.csv", { ...context,
      own(cleanup) { closing = cleanup(); }
    });
    await expect(opening).rejects.toMatchObject({ code: "invalid-request" });
    await closing!;
    expect(events).toEqual([]);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("drains admitted acquisition and prevents temp creation after cleanup starts", async () => {
    const { fs, context, cleanups, writeBytes, events, volume } = publication();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const lstat = fs.lstat;
    fs.lstat = async (path, options) => { await gate; return lstat(path, options); };
    const opening = createVfsOutput(fs, writeBytes)("/out.csv", context);
    let closed = false;
    const closing = Promise.resolve(cleanups[0]!()).then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await expect(opening).rejects.toMatchObject({ code: "invalid-request" });
    await closing;
    expect(events.some((event) => event.startsWith("create "))).toBe(false);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("retires a temp created by an already admitted exclusive create before cleanup settles", async () => {
    const { fs, context, cleanups, writeBytes, volume } = publication();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const admitted = new Promise<void>((resolve) => { started = resolve; });
    const create = fs.writeFile;
    fs.writeFile = async (path, bytes, options) => { await create(path, bytes, options); started(); await gate; };
    const opening = createVfsOutput(fs, writeBytes)("/out.csv", context);
    await admitted;
    let closed = false;
    const closing = Promise.resolve(cleanups[0]!()).then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(volume.existsSync("/.gsf-save-000000")).toBe(true);
    release();
    await expect(opening).rejects.toMatchObject({ code: "invalid-request" });
    await closing;
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("observes goal range cancellation before a following solve or save", async () => {
    const { config, volume } = splitFixture();
    const controller = new AbortController();
    const reason = { goalCancelled: true };
    const events: string[] = [];
    const engine = createEngine({ ...config, solver: {
      async goalSeekRange(book, range) {
        expect(range).toEqual({ sheet: "Two", startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
        events.push("goal"); controller.abort(reason); return book;
      }, async goalSeek(book) { events.push("structured-goal"); return book; },
      async solve(book) { events.push("solve"); return book; }
    } });
    await expect(engine.convert({ input: { kind: "resource", uri: "/in.csv" },
      destination: { kind: "resource", uri: "/out.csv" }, goalSeekExpressions: ["Two!A1:B2"], solve: true },
    { signal: controller.signal })).rejects.toBe(reason);
    expect(events).toEqual(["goal"]);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("keep");
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("checks invalid image options after automatic recalc and before graph resource acquisition", async () => {
    const { config, events, volume } = splitFixture();
    const stages: string[] = [];
    const engine = createEngine({ ...config,
      formulas: { async recalculate(book) { stages.push("auto"); return book; } },
      rendering: { async *exportGraphs() { stages.push("render"); yield { uri: "/graph.png",
        bytes: new Uint8Array([1]), mediaType: "image/png" }; } }
    });
    await expect(engine.convert({ input: { kind: "resource", uri: "/in.csv" },
      destination: { kind: "resource", uri: "/graph.png" }, graphs: true, exportOptions: ["resolution=0"] }, operation()))
      .rejects.toMatchObject({ message: 'ssconvert: Invalid export option "resolution=0" for image export' });
    expect(stages).toEqual(["auto", "auto"]);
    expect(events).toEqual([]);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it.each([false, true])("range overrides nonsplit selection and preserves split sheets (split=%s)", async (split) => {
    const { config } = splitFixture();
    const seen: string[][] = [];
    const codec: Codec = { ...config.codecs[0]!, sheetSelection: true, honorsExportRange: true,
      async write(_book, _options, _context, selection) {
        seen.push([...selection!.sheets]);
        expect(selection!.range!.sheet).toBe("Three");
        return new Uint8Array();
      }
    };
    await createEngine({ ...config, codecs: [codec] }).convert({ input: { kind: "resource", uri: "/in.csv" },
      destination: { kind: "resource", uri: split ? "/range.csv" : "file:///range.csv?ignored" }, perSheet: split,
      selection: { kind: "ids", ids: split ? ["One", "Two"] : ["One"] }, exportRangeExpression: "Three!A1" }, operation());
    expect(seen).toEqual(split ? [["One"], ["Two"]] : [["Three"]]);
  });

  it("shares completion of overlapping owned cleanup without double unlink", async () => {
    const { fs, context, writeBytes, events, cleanups, volume } = publication();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const unlink = fs.unlink!;
    fs.unlink = async (path, options) => { await gate; await unlink(path, options); };
    const output = await createVfsOutput(fs, writeBytes)("/out.csv", context);
    const first = output.abort();
    const second = cleanups[0]!();
    await expect(output.write(new Uint8Array([1]))).rejects.toMatchObject({ code: "invalid-request" });
    await expect(output.close()).rejects.toMatchObject({ code: "invalid-request" });
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(events.filter((event) => event === "unlink")).toHaveLength(1);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("shares the exact unlink rejection instead of hiding cleanup failure", async () => {
    const { fs, context, writeBytes, cleanups, volume } = publication();
    const failure = { cleanupDenied: true };
    let calls = 0;
    fs.unlink = async () => { calls++; throw failure; };
    const output = await createVfsOutput(fs, writeBytes)("/out.csv", context);
    await expect(output.abort()).rejects.toBe(failure);
    await expect(cleanups[0]!()).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(volume.existsSync("/.gsf-save-000000")).toBe(true);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("keep");
  });

  it("owns cleanup before acquisition and removes a cancelled temporary file", async () => {
    const { fs, context, controller, cleanups, events, volume, writeBytes } = publication();
    const output = await createVfsOutput(fs, writeBytes)("/out.csv", context);
    expect(events[0]).toBe("own");
    const reason = { cancelled: true };
    controller.abort(reason);
    await expect(output.write(new Uint8Array([1]))).rejects.toBe(reason);
    await cleanups[0]!();
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("keep");
  });

  it("replaces a hardlink output entry while preserving its input alias and mode", async () => {
    const { fs, context, volume, writeBytes } = publication();
    volume.unlinkSync("/out.csv");
    volume.chmodSync("/in.csv", 0o640);
    volume.linkSync("/in.csv", "/out.csv");
    const originalInode = volume.statSync("/in.csv").ino;
    const output = await createVfsOutput(fs, writeBytes)("/out.csv", context);
    await output.write(new TextEncoder().encode("changed"));
    await output.close();
    expect(volume.readFileSync("/in.csv", "utf8")).toBe("original");
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("changed");
    expect(volume.statSync("/in.csv").ino).toBe(originalInode);
    expect(volume.statSync("/out.csv").ino).not.toBe(originalInode);
    expect(volume.statSync("/out.csv").mode & 0o777).toBe(0o640);
  });

  it("keeps a relative output symlink and publishes to its target", async () => {
    const { fs, context, volume, writeBytes } = publication();
    volume.symlinkSync("out.csv", "/alias.csv");
    const output = await createVfsOutput(fs, writeBytes)("/alias.csv", context);
    await output.write(new TextEncoder().encode("changed"));
    await output.close();
    expect(volume.readlinkSync("/alias.csv")).toBe("out.csv");
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("changed");
  });

  it.each([false, true])("silently keeps published private mode after measured chmod EACCES (existing=%s)", async (existing) => {
    const { fs, context, volume, writeBytes, cleanups } = publication();
    if (!existing) volume.unlinkSync("/out.csv");
    fs.chmod = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    const diagnostics: string[] = [];
    const output = await createVfsOutput(fs, writeBytes)("/out.csv", { ...context,
      async diagnostic(value) { diagnostics.push(value.message); }
    });
    await output.write(new TextEncoder().encode("published"));
    await expect(output.close()).resolves.toBeUndefined();
    await cleanups[0]!();
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("published");
    expect(volume.statSync("/out.csv").mode & 0o777).toBe(0o600);
    expect(diagnostics).toEqual([]);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("preserves cancellation and opaque host errors from permission restoration", async () => {
    for (const cancellation of [false, true]) {
      const { fs, context, controller, volume, writeBytes } = publication();
      const failure = { permissionRestorationFailed: true };
      fs.chmod = async () => {
        if (cancellation) { controller.abort(failure); throw Object.assign(new Error("denied"), { code: "EACCES" }); }
        throw failure;
      };
      const output = await createVfsOutput(fs, writeBytes)("/out.csv", context);
      await output.write(new TextEncoder().encode("published"));
      await expect(output.close()).rejects.toBe(failure);
      expect(volume.readFileSync("/out.csv", "utf8")).toBe("published");
    }
  });

  it("keeps completed temp bytes after rename denial and removes them after write ENOSPC", async () => {
    const fixture = publication();
    fixture.fs.rename = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    const output = await createVfsOutput(fixture.fs, fixture.writeBytes)("/out.csv", fixture.context);
    await output.write(new TextEncoder().encode("complete"));
    await expect(output.close()).rejects.toMatchObject({ message: "E Permission denied" });
    await fixture.cleanups[0]!();
    expect(fixture.volume.readFileSync("/.gsf-save-000000", "utf8")).toBe("complete");
    expect(fixture.volume.readFileSync("/out.csv", "utf8")).toBe("keep");
    const full = publication();
    const failed = await createVfsOutput(full.fs, async () => {
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    })("/out.csv", full.context);
    await expect(failed.write(new Uint8Array([1]))).rejects.toMatchObject({ message: "E Failed to close file: No space left on device" });
    await full.cleanups[0]!();
    expect(full.volume.readdirSync("/")).toEqual(["in.csv", "out.csv"]);
  });

  it("applies one aggregate split output byte budget and preserves earlier publication", async () => {
    const { config, volume } = splitFixture(5);
    await expect(createEngine(config).convert({ input: { kind: "resource", uri: "/in.csv" },
      destination: { kind: "resource", uri: "/split.csv" }, exportType: "original", perSheet: true }, operation()))
      .rejects.toMatchObject({ code: "resource-limit", message: "ssconvert output bytes limit exceeded" });
    expect(volume.readFileSync("/split.csv.0", "utf8")).toBe("One");
    expect(volume.existsSync("/split.csv.1")).toBe(false);
    expect(volume.readdirSync("/")).toEqual(["in.csv", "out.csv", "split.csv.0"]);
  });

  it("publishes serial template collisions with the last sheet winning", async () => {
    const { config, volume } = splitFixture();
    const result = await createEngine(config).convert({ input: { kind: "resource", uri: "/in.csv" },
      destination: { kind: "resource", uri: "/collision%q.csv" }, exportType: "original", perSheet: true }, operation());
    expect(volume.readFileSync("/collision.csv", "utf8")).toBe("Three");
    expect(result.usage.outputBytes).toBe(11);
    expect(result.artifacts.map((artifact) => artifact.uri)).toEqual([
      "file:///collision.csv", "file:///collision.csv", "file:///collision.csv"
    ]);
  });
});
