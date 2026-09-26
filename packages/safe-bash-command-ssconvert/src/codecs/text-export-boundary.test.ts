import { runInNewContext } from "node:vm";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { createEngine, runCommand, type Workbook } from "../index.js";

it("preserves exact encoded budgets through CLI, SDK, foreign input and checkpoint replay", async () => {
  const volume = Volume.fromJSON({ "/input.csv": "é\n", "/keep": "original" });
  const config = {
    codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 2, cells: 100, sheets: 10, operations: 100 },
    filesystem: {
      async read(uri: string) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri: string, bytes: Uint8Array) { volume.writeFileSync(uri, bytes); }
    }
  };
  const engine = createEngine(config);
  const errors: string[] = [], chunks: Uint8Array[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write() { throw new Error("unexpected stdout publication"); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } } };
  const destination = { kind: "stream" as const, sink: {
    async write(bytes: Uint8Array) { chunks.push(new Uint8Array(bytes)); }
  } };
  const options = { exportType: "Gnumeric_stf:stf_assistant", exportOptions: ["charset=ISO-8859-1"] };
  const replay = createEngine({ ...config, codecs: [{ id: "checkpoint", description: "Original checkpoint", extensions: [],
    probeContent: () => true, async read(bytes) { return JSON.parse(new TextDecoder().decode(bytes)) as Workbook; } }] });
  try {
    expect(await runCommand(["-T", options.exportType, "-O", options.exportOptions[0]!, "/input.csv", "/keep"], engine, operation))
      .toMatchObject({ exitCode: 0, usage: { outputBytes: 2 } });
    expect(new Uint8Array(volume.readFileSync("/keep") as Uint8Array)).toEqual(new Uint8Array([233, 10]));
    const foreignBytes = runInNewContext("new Uint8Array([195,169,10])") as Uint8Array;
    const book = await engine.readWorkbook({ kind: "stream", filename: "foreign.csv", source: [foreignBytes] }, {}, operation);
    expect((await engine.writeWorkbook(book, destination, options, operation)).exitCode).toBe(0);
    expect((await replay.convert({ input: { kind: "stream", source: [new TextEncoder().encode(JSON.stringify(book))] },
      destination, ...options }, operation)).exitCode).toBe(0);
    expect(chunks).toEqual([new Uint8Array([233, 10]), new Uint8Array([233, 10])]);
    expect(errors).toEqual([]);
    expect((await runCommand(["-T", options.exportType, "/input.csv", "/keep"], engine, operation)).exitCode).toBe(1);
    expect(errors).toEqual(["ssconvert output bytes limit exceeded\n"]);
    expect(new Uint8Array(volume.readFileSync("/keep") as Uint8Array)).toEqual(new Uint8Array([233, 10]));
    expect(volume.readdirSync("/")).toEqual(["input.csv", "keep"]);
  } finally { await replay.dispose(); await engine.dispose(); }
});

it("rejects Unicode option argv under C before reading host bytes", async () => {
  let reads = 0;
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 1, operations: 10 },
    filesystem: { async read() { reads++; return []; }, async write() { throw new Error("unexpected publication"); } } });
  const errors: string[] = [];
  try {
    expect(await runCommand(["-O", "quote='😀🦊'", "/input.csv", "/keep"], engine, {
      signal: new AbortController().signal,
      stdout: { async write() { throw new Error("unexpected stdout publication"); } },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
    })).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["Invalid byte sequence in conversion input\nRun 'ssconvert --help' to see a full list of available command line options.\n"]);
    expect(reads).toBe(0);
  } finally { await engine.dispose(); }
});
