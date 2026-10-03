import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "./index.js";

it("converts generated text through replayable cells without the array reader or writer", async () => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let written = 0, largestWrite = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, position, options) => {
      written += bytes.length; largestWrite = Math.max(largestWrite, bytes.length);
      return write(bytes, position, options);
    });
    return handle;
  });
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole write"));
  const arrayRead = vi.fn(async () => { throw new Error("array reader"); });
  const arrayWrite = vi.fn(() => { throw new Error("array writer"); });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 },
    formats: [{ ...csvFormat, services: csvFormat.services.map(service => service.direction === "read" && service.readSource
      ? { ...service, readSource: arrayRead } : service.direction === "write" ? { ...service, write: arrayWrite, writeStream: arrayWrite } : service) }] });
  const bytes = new TextEncoder().encode("Name,Value\n" + ("a".repeat(128) + ",1.25\n").repeat(1000));
  const reused = new Uint8Array(127);
  async function* input() {
    for (let offset = 0; offset < bytes.length; offset += reused.length) {
      const size = Math.min(reused.length, bytes.length - offset);
      reused.set(bytes.subarray(offset, offset + size)); yield reused.subarray(0, size);
    }
  }
  let text = "", pending = 0, maximum = 0, writes = 0;
  const decoder = new TextDecoder();
  const result = await engine.convert({ input: { kind: "stream", source: input(), filename: "data.csv" },
    exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(chunk) {
      writes++; maximum = Math.max(maximum, ++pending); await Promise.resolve(); text += decoder.decode(chunk, { stream: true }); pending--;
    } } } }, { signal: new AbortController().signal });
  text += decoder.decode();
  expect(text).toBe(new TextDecoder().decode(bytes));
  expect(result.usage).toEqual({ inputBytes: bytes.length, outputBytes: bytes.length });
  expect(maximum).toBe(1); expect(writes).toBeGreaterThan(1); expect(arrayRead).not.toHaveBeenCalled(); expect(arrayWrite).not.toHaveBeenCalled();
  expect(written).toBeGreaterThan(16384); expect(largestWrite).toBeLessThanOrEqual(16384);
  expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});

it.each(["=SUM(A1:A1)", "1/2"])("keeps the evaluated array path for %s", async field => {
  const reader = csvFormat.services.find(service => service.readSource)!;
  const read = vi.fn(reader.readSource!);
  const now = vi.fn(() => Date.UTC(2020, 0, 1));
  const engine = createEngine({ clock: { now }, formats: [{ ...csvFormat,
    services: csvFormat.services.map(service => service === reader ? { ...service, readSource: read } : service) }] });
  const bytes = new TextEncoder().encode("1\n" + field + "\n"), chunks: Uint8Array[] = [];
  await engine.convert({ input: { kind: "range", filename: "data.csv", source: {
    size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); }
  } }, exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } } },
  { signal: new AbortController().signal });
  expect(read).toHaveBeenCalledTimes(1);
  if (field.startsWith("=")) expect(new TextDecoder().decode(chunks[0])).toBe("1\n1\n");
  else expect(now).toHaveBeenCalledTimes(1);
  await engine.dispose();
});

it.each(["source", "sink", "cancel"])("cleans up replayable conversion after %s failure", async mode => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const reason = new Error("injected failure"); let closed = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
    if (mode === "source") vi.spyOn(handle, "read").mockRejectedValue(reason);
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [csvFormat] });
  const sink = vi.fn(async () => { if (mode === "cancel") controller.abort(reason); else throw reason; });
  const chunk = new TextEncoder().encode("a,1.25\n".repeat(1000));
  async function* input() { for (let i = 0; i < 4; i++) yield chunk; }
  await expect(engine.convert({ input: { kind: "stream", filename: "data.csv", source: input() },
    exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { write: sink } } },
  { signal: controller.signal })).rejects.toBe(reason);
  if (mode === "source") expect(sink).not.toHaveBeenCalled();
  expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});

it("matches the array conversion path for inferred scalar values, empty cells, quoting, and charsets", async () => {
  const buffered = { ...csvFormat, services: csvFormat.services.map(service => {
    const { readWorkbookSource, ...rest } = service;
    void readWorkbookSource; return rest;
  }) };
  const texts = ["", "\n", ",,\n", '"a,b","x""y"\n', "Title,Value\na,1.25\nb,2.50\n",
    "Dates\n01/02/2020\n13/02/2020\n", "Values\nTRUE\nFALSE\n#N/A\n'3\n",
    "Numbers;Value\n1;1,25\n2;2,50\n", "a,b\r\n1,2\r\n", "🦀,é\n", "1.25", "1.25,2.50"];
  for (const text of texts) for (const charset of ["UTF-8", "UTF-16"]) {
    const bytes = new TextEncoder().encode(text), outputs: number[][] = [];
    for (const format of [buffered, csvFormat]) {
      const output: number[] = [], engine = createEngine({ formats: [format] });
      await engine.convert({ input: { kind: "range", filename: "data.csv", source: {
        size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); }
      } }, exportType: "Gnumeric_stf:stf_assistant", exportOptions: [`charset=${charset}`],
      destination: { kind: "stream", sink: { async write(chunk) { output.push(...chunk); } } } },
      { signal: new AbortController().signal });
      outputs.push(output); await engine.dispose();
    }
    expect(outputs[1], `${charset}: ${JSON.stringify(text)}`).toEqual(outputs[0]);
  }
});
