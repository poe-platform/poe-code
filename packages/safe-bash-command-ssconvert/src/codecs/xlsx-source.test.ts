import { expect, it, vi } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "@poe-code/spreadsheet-format-csv";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { xlsxFormat as provider } from "@poe-code/spreadsheet-format-xlsx";

it.each(["xlsx", "xlsx2"])("converts replayable text to %s without cell arrays", async edition => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let largestWrite = 0, persisted = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => {
      largestWrite = Math.max(largestWrite, bytes.length); persisted += bytes.length;
      return write(bytes, ...args);
    });
    return handle;
  });
  const array = vi.fn(() => { throw new Error("array path called"); });
  const formats = [{ ...csvFormat, services: csvFormat.services.map(codec => codec.readSource ?
    { ...codec, read: array, readSource: array } : codec) },
  { ...provider, services: provider.services.map(codec => codec.direction === "write" ?
    { ...codec, write: array, writeStream: array } : codec) }];
  const reference = createEngine({ formats: [{ ...csvFormat, services: csvFormat.services.map(codec => {
    const { readWorkbookSource, ...rest } = codec; void readWorkbookSource; return rest;
  }) }, provider] });
  const engine = createEngine({ formats, workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const input = new TextEncoder().encode("Title,Value,Date\n" + "a<&🦀,1.25,01/02/2020\n".repeat(400));
  const reused = new Uint8Array(127);
  async function* source() {
    for (let offset = 0; offset < input.length; offset += reused.length) {
      const length = Math.min(reused.length, input.length - offset);
      reused.set(input.subarray(offset, offset + length)); yield reused.subarray(0, length);
    }
  }
  const expected: Uint8Array[] = [], actual: Uint8Array[] = [];
  let outstanding = 0, maximum = 0;
  const operation = { signal: new AbortController().signal };
  try {
    await reference.convert({ input: { kind: "range", source: { size: input.length, async read(position, maximum) { return input.subarray(position, position + maximum); } }, filename: "data.csv" },
      exportType: `Gnumeric_Excel:${edition}`, destination: { kind: "stream", sink: { async write(bytes) { expected.push(bytes.slice()); } } } }, operation);
    await engine.convert({ input: { kind: "stream", source: source(), filename: "data.csv" },
      exportType: `Gnumeric_Excel:${edition}`, destination: { kind: "stream", sink: { async write(bytes) {
        outstanding += bytes.length; maximum = Math.max(maximum, outstanding);
        await Promise.resolve(); actual.push(bytes.slice()); outstanding -= bytes.length;
      } } } }, operation);
    expect(Buffer.concat(actual)).toEqual(Buffer.concat(expected));
    expect(array).not.toHaveBeenCalled(); expect(maximum).toBeLessThanOrEqual(16384);
    expect(actual.length).toBeGreaterThan(1); expect(persisted).toBeGreaterThan(16384);
    expect(largestWrite).toBeLessThanOrEqual(16384); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); await reference.dispose(); }
});

it.each(["xlsx", "xlsx2"])("publishes replayable %s files through the CLI", async edition => {
  const { createCommandArguments } = await import("safe-bash-contracts/command");
  const { toByteSource } = await import("safe-bash-contracts/io");
  const { createSsconvertCommand } = await import("../commands.js");
  const backend = createMemoryFileSystem();
  await backend.writeFile("/input.csv", new TextEncoder().encode("Name,Value\na,1.25\n"));
  const readFile = backend.readFile.bind(backend);
  vi.spyOn(backend, "readFile").mockRejectedValue(new Error("whole file read"));
  const array = vi.fn(() => { throw new Error("array path called"); });
  const formats = [{ ...csvFormat, services: csvFormat.services.map(codec => codec.readSource ?
    { ...codec, read: array, readSource: array } : codec) },
  { ...provider, services: provider.services.map(codec => codec.direction === "write" ?
    { ...codec, write: array, writeStream: array } : codec) }];
  const args = createCommandArguments(["-I", "Gnumeric_stf:stf_csvtab", "-T", `Gnumeric_Excel:${edition}`, "/input.csv", "/output.xlsx"]);
  const cleanups: (() => void | Promise<void>)[] = [], errors: string[] = [];
  try {
    const result = await createSsconvertCommand({ formats }).execute({ command: "ssconvert", args: args.args, argumentValues: args,
      cwd: "/", env: {}, fs: backend, signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); } });
    expect(result, errors.join("")).toMatchObject({ exitCode: 0 });
    const bytes = await readFile("/output.xlsx");
    const engine = createEngine({ formats: [provider, csvFormat] });
    const chunks: Uint8Array[] = [];
    try {
      await engine.convert({ input: { kind: "range", filename: "output.xlsx", source: {
        size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); }
      } }, exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: {
        async write(chunk) { chunks.push(chunk.slice()); }
      } } }, { signal: new AbortController().signal });
      expect(Buffer.concat(chunks).toString()).toContain("a,1.25");
    } finally { await engine.dispose(); }
    expect(array).not.toHaveBeenCalled();
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  expect((await backend.readdir("/")).map(entry => entry.name).sort()).toEqual(["input.csv", "output.xlsx"]);
});



it.each([false, true])('converts XLSX through one staged import (formulas: %s)', async formulas => {
  const { createXlsxWriter } = await import('./xlsx.js');
  const { defaultSsconvertLimits } = await import('@poe-code/spreadsheet-engine');
  const input = await createXlsxWriter('2008')({ sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 200 }, (_, row) => ({ row, column: 0,
    value: { kind: 'number' as const, value: row }, ...(formulas ? { formula: '=1+1', cachedResult: { kind: 'number' as const, value: 2 } } : {}) })) }] }, [],
  { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits, environment: { env: {}, locale: 'C', timezone: 'UTC' } });
  const fs = createMemoryFileSystem(), forbidden = vi.fn(() => { throw Error('wrong import/export path'); });
  vi.spyOn(fs, 'readFile').mockRejectedValue(Error('whole-file read')); vi.spyOn(fs, 'writeFile').mockRejectedValue(Error('whole-file write'));
  let imports = 0, acquired = 0;
  const staged = { ...provider, services: provider.services.map(codec => codec.direction !== 'read' ? codec : { ...codec, read: forbidden, readSource: forbidden,
    async readWorkbookSource(...args: Parameters<NonNullable<typeof codec.readWorkbookSource>>) {
      imports++; const [source, context, encoding] = args;
      return codec.readWorkbookSource!(source, { ...context, createWorkingStorage() { acquired++; return context.createWorkingStorage!(); } }, encoding);
    }
  }) };
  const output = { ...csvFormat, services: csvFormat.services.map(codec => codec.direction !== 'write' ? codec : formulas ? { ...codec, writeWorkbookSource: forbidden } : { ...codec, write: forbidden, writeStream: forbidden }) };
  const reference = createEngine({ formats: [{ ...provider, services: provider.services.map(codec => { const { readWorkbookSource, ...rest } = codec; void readWorkbookSource; return rest; }) }, csvFormat] });
  const engine = createEngine({ formats: [staged, output], workingFiles: { fs, directory: '/', cacheBytes: 16384 } });
  const expected: Uint8Array[] = [], actual: Uint8Array[] = [], borrowed = new Uint8Array(257);
  const operation = { signal: new AbortController().signal };
  try {
    await reference.convert({ input: { kind: 'range', source: { size: input.length, async read(at, count) { return input.subarray(at, at + count); } } }, importType: 'Gnumeric_Excel:xlsx', exportType: 'Gnumeric_stf:stf_csv',
      destination: { kind: 'stream', sink: { async write(bytes) { expected.push(bytes.slice()); } } } }, operation);
    await engine.convert({ input: { kind: 'range', source: { size: input.length, async read(at, count) { const take = Math.min(count, 257, input.length - at); borrowed.set(input.subarray(at, at + take)); return borrowed.subarray(0, take); } } }, importType: 'Gnumeric_Excel:xlsx', exportType: 'Gnumeric_stf:stf_csv',
      destination: { kind: 'stream', sink: { async write(bytes) { await Promise.resolve(); actual.push(bytes.slice()); } } } }, operation);
    expect(Buffer.concat(actual)).toEqual(Buffer.concat(expected)); expect(imports).toBe(1); expect(acquired).toBeGreaterThan(0); expect(forbidden).not.toHaveBeenCalled();
    expect(await fs.readdir('/')).toEqual([]);
  } finally { await engine.dispose(); await reference.dispose(); }
});
