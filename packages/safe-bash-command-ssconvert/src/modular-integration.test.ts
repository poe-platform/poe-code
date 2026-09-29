import { expect, it } from "vitest";
import { createEngine, defaultSsconvertLimits, updateWorkbook } from "./core.js";
import { createSsconvertCommand, createSsconvertCommands, ssconvertCommands } from "./commands.js";
import { csvFormat } from "./formats/csv.js";
import { xlsxFormat } from "./formats/xlsx.js";
import { createSsconvertCommand as createCompatibilityCommand } from "./command.js";
import { builtInDirectContextExecutors } from "safe-bash-contracts/runtime-control";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { CommandRegistry, createCommandArguments, toByteSource } from "safe-bash-contracts";

it("reads CSV, edits the AST, writes XLSX and returns through the selected CSV writer", async () => {
  const engine = createEngine({ formats: [csvFormat, xlsxFormat] });
  const operation = { signal: new AbortController().signal };
  const xlsx: Uint8Array[] = [], csv: Uint8Array[] = [];
  try {
    const original = await engine.readWorkbook({ kind: "stream", filename: "input.csv",
      source: [new TextEncoder().encode('Name,Amount\n"Łódź, office",12\n')] }, {}, operation);
    const edited = updateWorkbook(original, [{ sheet: original.sheets[0]!.id, row: 1, column: 1,
      value: { kind: "number", value: 34 } }], defaultSsconvertLimits);
    const adopted = await engine.adoptWorkbook(edited, operation);
    await engine.writeWorkbook(adopted, { kind: "stream", sink: { async write(bytes) { xlsx.push(bytes); } } },
      { exportType: "Gnumeric_Excel:xlsx2" }, operation);
    const decoded = await engine.readWorkbook({ kind: "stream", filename: "book.xlsx", source: xlsx }, {}, operation);
    await engine.writeWorkbook(decoded, { kind: "stream", sink: { async write(bytes) { csv.push(bytes); } } },
      { exportType: "Gnumeric_stf:stf_csv" }, operation);
    expect(csv.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe('Name,Amount\n"Łódź, office",34\n');
    expect(original.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)?.value)
      .toMatchObject({ kind: "number", value: 12 });
  } finally { await engine.dispose(); }
});

it("selected shell conversion preserves an existing destination when the output format is disabled", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("Name,Amount\nOffice,12\n"));
  await fs.writeFile("/saved.xlsx", new TextEncoder().encode("original destination"));
  const diagnostics: Uint8Array[] = [];
  const context = { command: "ssconvert", cwd: "/", env: {}, fs,
    ...createCommandArguments(["/input.csv", "/saved.xlsx"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { diagnostics.push(bytes); } }
  };
  expect((await createSsconvertCommand({ formats: [csvFormat] }).execute(context)).exitCode).not.toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/saved.xlsx"))).toBe("original destination");
  expect(diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("")).toContain("Unable to guess exporter");
  expect((await createSsconvertCommand({ formats: [csvFormat, xlsxFormat] }).execute(context)).exitCode).toBe(0);
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "saved.xlsx", source: [await fs.readFile("/saved.xlsx")] }, {}, context);
    expect(book.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)?.value)
      .toMatchObject({ kind: "number", value: 12 });
  } finally { await engine.dispose(); }
});

it("the neutral engine preserves cancellation identity before consuming selected-format input", async () => {
  const engine = createEngine({ formats: [csvFormat] });
  const controller = new AbortController(), reason = new Error("cancel selected conversion");
  controller.abort(reason);
  let consumed = false;
  try {
    await expect(engine.readWorkbook({ kind: "stream", filename: "input.csv", source: {
      async *[Symbol.asyncIterator]() { consumed = true; yield new TextEncoder().encode("A\n"); }
    } }, {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(consumed).toBe(false);
  } finally { await engine.dispose(); }
});

it("composable commands have no implicit formats and cannot use the compatibility fast path", async () => {
  const command = createSsconvertCommand();
  expect(builtInDirectContextExecutors.has(command.execute)).toBe(false);
  expect(builtInDirectContextExecutors.has(createSsconvertCommands()[0]!.execute)).toBe(false);
  const compatibility = createCompatibilityCommand();
  expect(builtInDirectContextExecutors.has(compatibility.execute)).toBe(true);
  const diagnostics: Uint8Array[] = [];
  const context = { command: "ssconvert", cwd: "/", env: {}, fs: new MemoryFileSystem(),
    ...createCommandArguments(["--list-importers"]), signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { diagnostics.push(bytes); } } };
  expect(await command.execute(context)).toEqual({ exitCode: 0 });
  expect(diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe("ID | Description\n");
  diagnostics.length = 0;
  expect(await compatibility.execute(context)).toEqual({ exitCode: 0 });
  const listing = diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("");
  expect(listing).toContain("Gnumeric_Excel:xlsx");
  expect(listing).toContain("Gnumeric_OpenCalc");
});

it("the composable plugin snapshots formats and refuses duplicate registration unless replace is requested", async () => {
  const formats = [csvFormat];
  const plugin = ssconvertCommands({ formats });
  formats.length = 0;
  const registry = new CommandRegistry();
  const host = { commands: registry, use() {}, registerFileSystem() {} };
  plugin.setup(host);
  expect(() => plugin.setup(host)).toThrow("Command already registered");
  const captured = registry.get("ssconvert")!;
  ssconvertCommands({ formats: [csvFormat], replace: true }).setup(host);
  const diagnostics: Uint8Array[] = [];
  expect(await captured.execute({ command: "ssconvert", cwd: "/", env: {}, fs: new MemoryFileSystem(),
    ...createCommandArguments(["--list-importers"]), signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { diagnostics.push(bytes); } }
  })).toEqual({ exitCode: 0 });
  const listing = diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("");
  expect(listing).toContain("Gnumeric_stf:stf_csvtab");
  expect(listing).not.toContain("Gnumeric_Excel");
});
