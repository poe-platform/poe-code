import { expect, it } from "vitest";
import * as sdk from "safe-bash-command-ssconvert";
import { CommandRegistry, createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createMemoryFileSystem, retainFileSystemCleanup, scopeFileSystem } from "@poe-code/safe-fs/core";
import type { CapabilityContext, SsconvertCommandsOptions, Workbook } from "safe-bash-command-ssconvert";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10, sheets: 2, operations: 20 }
};
it("exports command factories and plugin with configurable public options", () => {
  const options: SsconvertCommandsOptions = { limits: { inputBytes: 1024 } };
  expect(sdk.createSsconvertCommand(options).name).toBe("ssconvert");
  expect(sdk.createSsconvertCommands(options).map(command => command.name)).toEqual(["ssconvert"]);
  expect(sdk.ssconvertCommands(options)).toMatchObject({ name: "ssconvert-commands", setup: expect.any(Function) });
});
it("cleans multiple cancelled output publications with one operation per retained output", async () => {
  const backing = createMemoryFileSystem();
  const controller = new AbortController();
  const fs = scopeFileSystem(backing, () => {}, controller.signal);
  const cleanups: (() => void | Promise<void>)[] = [];
  const operation = { ...context, signal: controller.signal, own(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); } };
  const open = sdk.createVfsOutput(fs, (path, bytes, signal) => fs.writeFile(path, bytes, { signal }),
    cleanup => retainFileSystemCleanup(fs, view => cleanup(path => view.rm(path)), { maxOperations: 1 }));
  const first = await open("/first.csv", operation);
  const second = await open("/second.csv", operation);
  await first.write(new TextEncoder().encode("first"));
  await second.write(new TextEncoder().encode("second"));
  expect(await backing.readdir("/")).toHaveLength(2);
  controller.abort();
  await Promise.all(cleanups.map(cleanup => cleanup()));
  await Promise.all(cleanups.map(cleanup => cleanup()));
  expect(await backing.readdir("/")).toEqual([]);
});
it("exports reusable bounded XLSX codecs and captured help through the public SDK", async () => {
  expect(sdk).toHaveProperty("readXlsx", expect.any(Function));
  expect(sdk).toHaveProperty("createXlsxWriter", expect.any(Function));
  expect(sdk).toHaveProperty("referenceText");
  const book: Workbook = { sheets: [{ id: "original", name: "Original", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Portable λ" } },
    { row: 1, column: 1, value: { kind: "number", value: 42 } }
  ] }] };
  for (const edition of ["2006", "2008"] as const) {
    const bytes = await sdk.createXlsxWriter(edition)(book, [], context);
    const reopened = await sdk.readXlsx(bytes, context);
    expect(reopened.sheets[0]?.name).toBe("Original");
    expect(reopened.sheets[0]?.cells.map(cell => cell.value)).toEqual(book.sheets[0]!.cells.map(cell => cell.value));
    await expect(sdk.readXlsx(bytes, { ...context, limits: { ...context.limits, inputBytes: bytes.length - 1 } }))
      .rejects.toMatchObject({ code: "resource-limit" });
    const controller = new AbortController(), reason = new Error("cancel reusable reader");
    controller.abort(reason);
    await expect(sdk.readXlsx(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
  }
});

// Adding an SDK request field requires assigning its command operation/configuration.
const commandCoverage = {
  input: "INFILE", destination: "OUTFILE/-M", importType: "-I", importEncoding: "-E",
  exportType: "-T", exportOptions: "-O", updates: "--set", updateExpressions: "--set",
  selection: "-O sheet/active-sheet/sheets", exportRange: "--export-range",
  exportRangeExpression: "--export-range", goalSeekExpressions: "--goal-seek",
  recalc: "--recalc", solve: "--solve", goalSeek: "--goal-seek", analysis: "--tool-test",
  resize: "--resize", resizeExpression: "--resize", toolTest: "--tool-test",
  perSheet: "-S", verbose: "-v", graphs: "--export-graphs", clipboard: "--clipboard"
} satisfies Record<keyof sdk.ConversionRequest, string>;

it("keeps every SDK conversion control assigned to a genuine CLI operation", () => {
  expect(Object.values(commandCoverage).every(operation => operation.length > 0)).toBe(true);
});

it.each([undefined, {}])("converts CSV through XLSX with all portable command factories (%j)", async options => {
  const fs = createMemoryFileSystem();
  const input = "Name,Score\nAlice,95.5\n";
  await fs.writeFile("/input.csv", new TextEncoder().encode(input));
  const commands = new CommandRegistry();
  sdk.ssconvertCommands(options).setup({ commands, use() {}, registerFileSystem() {} });
  const factories = [sdk.createSsconvertCommand(options), sdk.createSsconvertCommands(options)[0]!, commands.get("ssconvert")!];
  let stderr = "";
  for (const command of factories) {
    for (const args of [["/input.csv", "/output.xlsx"], ["/output.xlsx", "/roundtrip.csv"]]) {
      const result = await command.execute({ command: "ssconvert", cwd: "/", env: {}, fs,
        ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(stderr).toBe("");
      expect(result.exitCode).toBe(0);
    }
    expect(new TextDecoder().decode(await fs.readFile("/roundtrip.csv"))).toBe(input);
  }
});

it("re-exports reusable rendering from the independent spreadsheet engine", async () => {
  const images = await import("@poe-code/spreadsheet-engine/rendering/images/index");
  const axis = await import("@poe-code/spreadsheet-engine/rendering/chart/axis");
  expect(sdk.createImageRendering).toBe(images.createImageRendering);
  expect(sdk.createAxisMap).toBe(axis.createAxisMap);
});
