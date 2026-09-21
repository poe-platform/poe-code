import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Codec } from "../index.js";

it.each(["cells", "sheets", "operations"])("preserves destination and namespace when %s admission fails", async limit => {
  const volume = Volume.fromJSON({ "/input.fixture": "original", "/output.fixture": "keep" });
  const codec: Codec = { id: "fixture", description: "Original bounded analysis fixture", extensions: ["fixture"], probeContent: () => true,
    async read() { return { sheets: [{ id: "s", name: "Input", cells: [1,2,3,4].map((value, row) => ({ row, column: 0, value: { kind: "number" as const, value } })) }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const engine = createEngine({ codecs: [codec], limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 10000, [limit]: limit === "operations" ? 20 : limit === "sheets" ? 1 : 5 },
    environment: { env: {}, locale: "C", timezone: "UTC" }, filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; }, async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  try {
    const stderr: string[] = [];
    const result = await runCommand(["--tool-test=descriptive-statistics", "--tool-test=data:A1:A4", "/input.fixture", "/output.fixture"], engine,
      { signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } } });
    expect(result.exitCode).toBe(1);
    expect(stderr.length).toBe(1);
    expect(stderr[0]).toBe("ssconvert analysis output exceeds workbook limits\n");
    expect(volume.toJSON()).toEqual({ "/input.fixture": "original", "/output.fixture": "keep" });
  } finally { await engine.dispose(); }
});

it("preserves the exact falsey pre-aborted cancellation reason without reading input", async () => {
  const volume = Volume.fromJSON({ "/input.csv": "1,2\n2,4\n", "/output.csv": "keep" });
  const engine = createEngine({ codecs: [], limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 10000 },
    environment: { env: {}, locale: "C", timezone: "UTC" }, filesystem: {
      async read() { throw new Error("must not acquire input after cancellation"); }, async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  const controller = new AbortController(); controller.abort(false);
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/input.csv" }, destination: { kind: "resource", uri: "/output.csv" }, toolTest: ["correlation", "data:A1:B2"] },
      { signal: controller.signal })).rejects.toBe(false);
    expect(volume.toJSON()).toEqual({ "/input.csv": "1,2\n2,4\n", "/output.csv": "keep" });
  } finally { await engine.dispose(); }
});
