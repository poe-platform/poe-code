import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { compareCapture, coverageGate, type Capture } from "./gates.js";

function capture(): Capture {
  const fs = Volume.fromJSON({ "/original.csv": "A,B\n1,2\n" });
  return { sourceHash: "source", profileHash: "profile", inputHash: "input",
    argv: [[45, 45, 118, 101, 114, 115, 105, 111, 110]], stdin: [],
    env: [["LC_ALL", "C"], ["TZ", "UTC"]], cwd: "/", status: 0,
    stdout: [49, 10], stderr: [],
    before: [{ path: "/original.csv", kind: "file", mode: 33188, bytes: [...fs.readFileSync("/original.csv") as Uint8Array] }],
    after: [{ path: "/original.csv", kind: "file", mode: 33188, bytes: [...fs.readFileSync("/original.csv") as Uint8Array] }] };
}
describe("canonical differential evidence gates", () => {
  it("rejects missing coverage instead of treating an empty corpus as a pass", () => {
    expect(coverageGate(["option:version", "exporter:xlsx"], [])).toEqual({ pass: false, denominator: 2, passed: 0,
      missing: ["option:version", "exporter:xlsx"], blocked: [], mismatched: [] });
  });
  it("compares warning bytes, argv bytes, status, order and namespace effects", () => {
    const reference = capture();
    expect(compareCapture(reference, capture())).toEqual([]);
    for (const key of ["stderr", "stdout", "stdin", "argv", "env", "cwd", "status", "before", "after", "sourceHash", "profileHash", "inputHash"] as const) {
      const candidate = { ...capture(), [key]: null } as unknown as Capture;
      expect(compareCapture(reference, candidate)).toContain(key);
    }
    const candidate = capture();
    candidate.after.push({ path: "/empty", kind: "directory", mode: 16877 });
    expect(compareCapture(reference, candidate)).toEqual(["after"]);
    expect(compareCapture(reference, { ...candidate, env: [...candidate.env].reverse() })).toContain("env");
  });
  it("requires semantic, round-trip and interoperability gates in addition to exact command evidence", () => {
    expect(coverageGate(["xlsx"], [{ feature: "xlsx", state: "passed", exact: true, structured: true }]).pass).toBe(false);
    expect(coverageGate(["xlsx"], [{ feature: "xlsx", state: "passed", exact: true, structured: true,
      semantic: true, roundTrip: true, interoperability: true, receipts: { sourceHash: "a".repeat(64), profileHash: "b".repeat(64), inputHash: "c".repeat(64), referenceHash: "d".repeat(64), candidateHash: "e".repeat(64) } }]).pass).toBe(true);
  });
  it("keeps blocked and mismatched evidence visible and refuses duplicates or foreign entries", () => {
    expect(coverageGate(["a", "b"], [{ feature: "a", state: "blocked", reason: "native unavailable" },
      { feature: "b", state: "mismatched", reason: "warning lost" }])).toMatchObject({ pass: false, blocked: ["a"], mismatched: ["b"] });
    expect(() => coverageGate(["a"], [{ feature: "foreign", state: "passed", exact: true }])).toThrow();
    expect(() => coverageGate(["a", "a"], [])).toThrow();
    expect(() => coverageGate(["a"], [{ feature: "a", state: "passed", exact: true }, { feature: "a", state: "passed", exact: true }])).toThrow();
  });
});

import { createEngine, runCommand, type EngineConfig } from "../index.js";

describe("canonical shared command engine corpus", () => {
  function fixture() {
    const volume = Volume.fromJSON({ "/in.original": "red,blue\n" });
    const config: EngineConfig = {
      codecs: [{ id: "original", description: "Original byte fixture", extensions: ["original"],
        probeContent: () => true,
        async read(bytes) { return { sheets: [{ id: "s", name: "Sheet", cells: [
          { row: 0, column: 0, value: { kind: "string", value: new TextDecoder().decode(bytes) } }
        ] }] }; },
        async write(book) { const value = book.sheets[0]!.cells[0]!.value;
          return new TextEncoder().encode(value.kind === "string" ? value.value : ""); }
      }], environment: { env: { LC_ALL: "C", TZ: "UTC" }, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 100, outputBytes: 1000, cells: 10, sheets: 2, operations: 10 },
      filesystem: {
        async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
        async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); }
      }
    };
    return { volume, engine: createEngine(config) };
  }
  it("preserves command and SDK conversion bytes and namespace", async () => {
    const cli = fixture(), sdk = fixture(), stdout: number[] = [], stderr: number[] = [];
    const operation = { signal: new AbortController().signal };
    const result = await runCommand(["-I", "original", "-T", "original", "/in.original", "/out.original"], cli.engine,
      { ...operation, stdout: { async write(bytes) { stdout.push(...bytes); } }, stderr: { async write(bytes) { stderr.push(...bytes); } } });
    const direct = await sdk.engine.convert({ input: { kind: "resource", uri: "/in.original" },
      destination: { kind: "resource", uri: "/out.original" }, importType: "original", exportType: "original" }, operation);
    expect(result.exitCode).toBe(0);
    expect(direct.exitCode).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(cli.volume.toJSON()).toEqual({ "/in.original": "red,blue\n", "/out.original": "red,blue\n" });
    expect(cli.volume.toJSON()).toEqual(sdk.volume.toJSON());
  });
  it("rejects parser errors before file reads and preserves exact diagnostics and status", async () => {
    const { volume, engine } = fixture(), stderr: number[] = [];
    const result = await runCommand(["--unknown", "/absent", "/out.original"], engine,
      { signal: new AbortController().signal, stdout: { async write() { throw new Error("unexpected stdout"); } },
        stderr: { async write(bytes) { stderr.push(...bytes); } } });
    expect(result.exitCode).toBe(1);
    expect(stderr).toEqual([...new TextEncoder().encode("Unknown option --unknown\nRun 'ssconvert --help' to see a full list of available command line options.\n")]);
    expect(volume.toJSON()).toEqual({ "/in.original": "red,blue\n" });
  });
  it("honors cancellation before command dispatch and leaves the namespace unchanged", async () => {
    const { volume, engine } = fixture(), controller = new AbortController();
    controller.abort(new Error("original cancellation"));
    await expect(runCommand(["/in.original", "/out.original"], engine, { signal: controller.signal,
      stdout: { async write() {} }, stderr: { async write() {} } })).rejects.toThrow("original cancellation");
    expect(volume.toJSON()).toEqual({ "/in.original": "red,blue\n" });
  });
});
