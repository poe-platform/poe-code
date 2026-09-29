import { expect, it } from "vitest";
import { createEngine, type Codec } from "./index.js";

it("composes only the supplied reader and writer while owning their workbook", async () => {
  const source = { sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "number" as const, value: 42 } }
  ] }] };
  const codec: Codec = { id: "fixture", description: "memory fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return source; },
    async write(book) { return new TextEncoder().encode(String(book.sheets[0]!.cells[0]!.value.kind)); }
  };
  const engine = createEngine({ codecs: [codec] });
  const chunks: Uint8Array[] = [];
  try {
    expect(engine.listServices("read").map(service => service.id)).toEqual(["fixture"]);
    const result = await engine.convert({ input: { kind: "stream", source: [], filename: "data.fixture" },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(bytes); } } }, exportType: "fixture"
    }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(chunks[0])).toBe("number");
    expect(Object.isFrozen(source.sheets)).toBe(false);
  } finally { await engine.dispose(); }
});

it("never installs formats or discovers host I/O implicitly", async () => {
  const engine = createEngine();
  try {
    expect(engine.listServices("read")).toEqual([]);
    expect(engine.listServices("write")).toEqual([]);
    await expect(engine.readWorkbook({ kind: "resource", uri: "/private.xlsx" }, {},
      { signal: new AbortController().signal })).rejects.toThrow();
  } finally { await engine.dispose(); }
});

it("adopts a caller workbook as a bounded immutable snapshot before export", async () => {
  const engine = createEngine({ limits: { cells: 1 }, codecs: [{ id: "fixture", description: "owned model", extensions: [],
    async write(book) { return new TextEncoder().encode(String(book.sheets[0]!.cells[0]!.value.kind)); }
  }] });
  const source = { sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "number" as const, value: 42 } }
  ] }] };
  const operation = { signal: new AbortController().signal };
  try {
    const adopted = await engine.adoptWorkbook(source, operation);
    source.sheets[0]!.cells[0]!.value.value = 99;
    expect(adopted.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
    expect(Object.isFrozen(adopted.sheets[0]!.cells)).toBe(true);
    const output: Uint8Array[] = [];
    await engine.writeWorkbook(adopted, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } }, { exportType: "fixture" }, operation);
    expect(new TextDecoder().decode(output[0])).toBe("number");
    source.sheets[0]!.cells.push({ row: 1, column: 0, value: { kind: "number", value: 2 } });
    await expect(engine.adoptWorkbook(source, operation)).rejects.toMatchObject({ code: "resource-limit" });
    const reason = new Error("cancel adoption");
    await expect(engine.adoptWorkbook(source, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  } finally { await engine.dispose(); }
  await expect(engine.adoptWorkbook(source, operation)).rejects.toThrow("disposed");
});
