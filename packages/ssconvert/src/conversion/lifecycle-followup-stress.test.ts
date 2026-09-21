import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand, type Codec, type EngineConfig } from "../index.js";

function fixture() {
  const volume = Volume.fromJSON({ "/in.data": "small", "/keep.csv": "keep" });
  const events: string[] = [];
  const codec: Codec = {
    id: "original", description: "Original followup fixture", extensions: ["csv"],
    probeContent: () => true,
    async read() { events.push("load"); return { sheets: [{ id: "s", name: "Sheet", cells: [] }] }; },
    async write() { events.push("save"); return new Uint8Array([65]); }
  };
  const config: EngineConfig = {
    codecs: [codec], environment: { env: { PWD: "/" }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 200, cells: 10, sheets: 10, operations: 10 },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(uri) { events.push("read"); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { events.push("publish"); volume.writeFileSync(uri, bytes); }
    } }),
    formulas: { async recalculate(book) { events.push("recalc"); return book; } },
    rendering: { async *exportGraphs() { events.push("render"); yield* []; } }
  };
  return { config, events, volume };
}
const operation = () => ({ signal: new AbortController().signal });
const graphRequest = { input: { kind: "resource" as const, uri: "/in.data" },
  destination: { kind: "resource" as const, uri: "/graph.png" }, graphs: true, recalc: true, exportType: "png" };

describe("independent lifecycle followup negative controls", () => {
  it.each(["1", "10000", "1junk", "1e2tail", "+2.5", "0x2", "0X2710", "1e", "1.0.0"])
  ("admits the source-derived decimal-prefix and whole-hex subset: %s", async (value) => {
    const { config, events, volume } = fixture();
    const result = await createEngine(config).convert({ ...graphRequest, exportOptions: [`resolution=${value}`] }, operation());
    expect(result).toMatchObject({ exitCode: 0, artifacts: [], usage: { inputBytes: 5, outputBytes: 0 } });
    expect(events).toEqual(["read", "load", "recalc", "recalc", "render"]);
    expect(volume.toJSON()).toEqual({ "/in.data": "small", "/keep.csv": "keep" });
  });

  it.each(["0b10", "0o10", "0B100000", "0O10000", "0", "0.999", "10001", "-2", "NaN", "Infinity", "1e999"])
  ("rejects %s identically through SDK and CLI after both recalculations", async (value) => {
    const expected = `ssconvert: Invalid export option "resolution=${value}" for image export`;
    const sdk = fixture();
    await expect(createEngine(sdk.config).convert({ ...graphRequest, exportOptions: [`resolution=${value}`] }, operation()))
      .rejects.toMatchObject({ exitCode: 1, code: "invalid-request", message: expected });
    expect(sdk.events).toEqual(["read", "load", "recalc", "recalc"]);
    const cli = fixture();
    const stderr: string[] = [];
    const stdout: Uint8Array[] = [];
    const result = await runCommand(["--export-graphs", "--recalc", "-T", "png", "-O", `resolution=${value}`,
      "/in.data", "/graph.png"], createEngine(cli.config), { ...operation(),
      stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } }
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(stderr).toEqual([`${expected}\n`]);
    expect(stdout).toEqual([]);
    expect(cli.events).toEqual(sdk.events);
    expect(cli.volume.toJSON()).toEqual(sdk.volume.toJSON());
  });

  it("prioritizes cancellation during explicit recalc over invalid graph options and automatic recalc", async () => {
    const { config, events, volume } = fixture();
    const controller = new AbortController();
    const reason = Object.freeze({ stage: "recalc" });
    const engine = createEngine({ ...config, formulas: { async recalculate(book) {
      events.push("cancel-recalc"); controller.abort(reason); return book;
    } } });
    await expect(engine.convert({ ...graphRequest, exportOptions: ["resolution=0b10"] }, { signal: controller.signal }))
      .rejects.toBe(reason);
    expect(events).toEqual(["read", "load", "cancel-recalc"]);
    expect(volume.toJSON()).toEqual({ "/in.data": "small", "/keep.csv": "keep" });
  });

  it("does not read or infer output for an already aborted invocation", async () => {
    const { config, events, volume } = fixture();
    const reason = Object.freeze({ caller: "abort" });
    const controller = new AbortController();
    controller.abort(reason);
    await expect(createEngine(config).convert({ input: graphRequest.input, exportType: "original" },
      { signal: controller.signal })).rejects.toBe(reason);
    expect(events).toEqual([]);
    expect(volume.toJSON()).toEqual({ "/in.data": "small", "/keep.csv": "keep" });
  });

  it("enforces operation budget before acquiring input for combined flags", async () => {
    const { config, events } = fixture();
    const engine = createEngine({ ...config, limits: { ...config.limits, operations: 2 } });
    await expect(engine.convert({ ...graphRequest, solve: true, exportOptions: ["resolution=0b10"] }, operation()))
      .rejects.toMatchObject({ code: "resource-limit", message: "ssconvert operations limit exceeded" });
    expect(events).toEqual([]);
  });

  it("refuses resource conversion without injected filesystem capability", async () => {
    const { config, events } = fixture();
    const { filesystem: ignoredFilesystem, ...withoutFilesystem } = config;
    const engine = createEngine(withoutFilesystem);
    await expect(engine.convert({ input: graphRequest.input, exportType: "original" }, operation()))
      .rejects.toMatchObject({ code: "capability-denied", message: "Filesystem write capability is required" });
    expect(events).toEqual([]);
  });

  it("refuses a workbook from another engine before output acquisition", async () => {
    const owner = fixture();
    const other = fixture();
    const book = await createEngine(owner.config).readWorkbook(graphRequest.input, {}, operation());
    await expect(createEngine(other.config).writeWorkbook(book, { kind: "resource", uri: "/keep.csv" },
      { exportType: "original" }, operation())).rejects.toMatchObject({ message: "Workbook belongs to another engine" });
    expect(other.events).toEqual([]);
    expect(other.volume.readFileSync("/keep.csv", "utf8")).toBe("keep");
  });

  it("gives unknown output extension status 2 before loading even with binary graph option text", async () => {
    const { config, events, volume } = fixture();
    const errors: string[] = [];
    const result = await runCommand(["-I", "unknown", "--recalc", "-O", "resolution=0b10", "/in.data", "/out.unknown"],
      createEngine(config), { ...operation(), stdout: { async write() {} },
        stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } });
    expect(result).toEqual({ exitCode: 2 });
    expect(errors).toEqual(["Unable to guess exporter to use for 'file:///out.unknown'.\nTry --list-exporters to see a list of possibilities.\n"]);
    expect(events).toEqual([]);
    expect(volume.toJSON()).toEqual({ "/in.data": "small", "/keep.csv": "keep" });
  });
});
