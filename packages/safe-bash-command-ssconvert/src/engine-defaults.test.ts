import { expect, it } from "vitest";
import { createEngine, runCommand, type CapabilityContext } from "./index.js";

it.each([undefined, {}, { codecs: [] }, { environment: {} }, { environment: { cwd: "/", env: {} } }])(
  "converts CSV to XLSX with partial SDK options %j", async options => {
    const engine = createEngine(options), chunks: Uint8Array[] = [];
    try {
      const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("Name,Value\nexample,7\n")] },
        importType: "Gnumeric_stf:stf_csvtab", exportType: "Gnumeric_Excel:xlsx",
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
      expect(result.exitCode).toBe(0);
      expect(result.diagnostics).toEqual([]);
      expect(chunks.reduce((sum, bytes) => sum + bytes.length, 0)).toBeGreaterThan(100);
      expect(engine.limits.argumentBytes).toBe(Infinity);
    } finally { await engine.dispose(); }
  }
);

it("runs help on a zero-argument engine", async () => {
  const engine = createEngine(), output: string[] = [];
  try {
    expect((await runCommand(["--help"], engine, { signal: new AbortController().signal,
      stdout: { async write(bytes) { output.push(new TextDecoder().decode(bytes)); } },
      stderr: { async write() { throw new Error("unexpected diagnostic"); } } })).exitCode).toBe(0);
    expect(output.join("")).toContain("Usage:");
  } finally { await engine.dispose(); }
});

it("defaults only missing environment fields and snapshots injected state", async () => {
  const observed: CapabilityContext[] = [], env = { PWD: "/logical", TZ: "UTC" };
  const engine = createEngine({ environment: { env }, limits: { inputBytes: 1 }, codecs: [{
    id: "observe", description: "Observe explicit context", extensions: [], async read(_bytes, context) {
      observed.push(context); return { sheets: [{ id: "s", name: "S", cells: [] }] };
    }
  }] });
  env.PWD = "/changed";
  try {
    await engine.readWorkbook({ kind: "stream", source: [new Uint8Array([0])] }, { importType: "observe" }, { signal: new AbortController().signal });
    expect(observed[0]!.environment).toMatchObject({ cwd: "/logical", locale: "C", timezone: "UTC", env: { PWD: "/logical", TZ: "UTC" } });
    expect(engine.limits.inputBytes).toBe(1);
    await expect(engine.readWorkbook({ kind: "stream", source: [new Uint8Array([0, 1])] }, { importType: "observe" }, { signal: new AbortController().signal })).rejects.toMatchObject({ code: "resource-limit" });
  } finally { await engine.dispose(); }
});
