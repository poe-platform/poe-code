import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, type EngineConfig } from "./index.js";

function fixture(input: string, outputBytes: number, overrides: Partial<EngineConfig> = {}) {
  const volume = Volume.fromJSON({ "/input.csv": input, "/output.csv": "preserve" });
  let writes = 0;
  const engine = createEngine({
    codecs: [], environment: { env: { LC_ALL: "C.UTF-8" }, locale: "C.UTF-8", timezone: "UTC" },
    limits: { inputBytes: 4096, outputBytes, cells: 10, sheets: 2, operations: 100 },
    ...overrides,
    filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { writes++; volume.writeFileSync(path, bytes); }
    }
  });
  return { engine, volume, writes: () => writes };
}

it.each([
  ["\u0301".repeat(512), "transliterate", 1, "\n"],
  ["\u0301".repeat(512) + "😀", "transliterate", 4, ":-D\n"],
  ["ßßß", "transliterate", 7, "ssssss\n"],
  ["😀", "escape", 11, "\\U0001f600\n"]
])("SDK emits exact converted bytes for original fixture %#", async (input, mode, outputBytes, expected) => {
  const { engine, volume, writes } = fixture(input + "\n", outputBytes);
  try {
    const result = await engine.convert({ input: { kind: "resource", uri: "/input.csv" },
      destination: { kind: "resource", uri: "/output.csv" }, exportType: "Gnumeric_stf:stf_assistant",
      exportOptions: [`charset=ASCII transliterate-mode=${mode}`] }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(result.usage.outputBytes).toBe(outputBytes);
    expect(new Uint8Array(volume.readFileSync("/output.csv") as Uint8Array)).toEqual(new TextEncoder().encode(expected));
    expect(volume.readFileSync("/input.csv", "utf8")).toBe(input + "\n");
    expect(writes()).toBe(1);
  } finally { await engine.dispose(); }
});

it.each([
  ["\u0301".repeat(512) + "😀", "transliterate", 3],
  ["ßßß", "transliterate", 6],
  ["😀", "escape", 10]
])("SDK retains final byte budget and destination for original fixture %#", async (input, mode, outputBytes) => {
  const { engine, volume, writes } = fixture(input + "\n", outputBytes);
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/input.csv" },
      destination: { kind: "resource", uri: "/output.csv" }, exportType: "Gnumeric_stf:stf_assistant",
      exportOptions: [`charset=ASCII transliterate-mode=${mode}`] }, { signal: new AbortController().signal }))
      .rejects.toThrow("output bytes limit exceeded");
    expect(volume.readFileSync("/output.csv", "utf8")).toBe("preserve");
    expect(writes()).toBe(0);
  } finally { await engine.dispose(); }
});

it("bounds aggregate generated intermediate text despite all scalars disappearing", async () => {
  const { engine, volume, writes } = fixture("1,1,1,1\n", 1, {
    limits: { inputBytes: 256, outputBytes: 1, cells: 10, sheets: 2, operations: 100 },
    formatting: { async format() { return "\u0301".repeat(70); } }
  });
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/input.csv" },
      destination: { kind: "resource", uri: "/output.csv" }, exportType: "Gnumeric_stf:stf_assistant",
      exportOptions: ["charset=ASCII separator='' quoting-mode=never"] },
    { signal: new AbortController().signal })).rejects.toThrow("output bytes limit exceeded");
    expect(volume.readFileSync("/output.csv", "utf8")).toBe("preserve");
    expect(writes()).toBe(0);
  } finally { await engine.dispose(); }
});

it("preserves cancellation from an injected formatter before retaining/publishing converted text", async () => {
  const controller = new AbortController();
  const reason = { cancellation: "formatter" };
  const { engine, volume, writes } = fixture("1\n", 1, {
    formatting: { async format() { controller.abort(reason); return "\u0301".repeat(512); } }
  });
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/input.csv" },
      destination: { kind: "resource", uri: "/output.csv" }, exportType: "Gnumeric_stf:stf_assistant",
      exportOptions: ["charset=ASCII"] }, { signal: controller.signal })).rejects.toBe(reason);
    expect(volume.readFileSync("/output.csv", "utf8")).toBe("preserve");
    expect(writes()).toBe(0);
  } finally { await engine.dispose(); }
});
