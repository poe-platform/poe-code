import { expect, it } from "vitest";
import { createEngine, createSsconvertCommand, runCommand, xlsxFormat, type Codec, type FormatProvider } from "./index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import textFormat from "./codecs/providers/stf.js";

const operation = () => ({ signal: new AbortController().signal });

it("an explicit empty format selection installs no implicit readers or writers", async () => {
  const engine = createEngine({ formats: [] });
  try {
    expect(engine.listServices("read")).toEqual([]);
    expect(engine.listServices("write")).toEqual([]);
    await expect(engine.readWorkbook({ kind: "stream", filename: "input.csv",
      source: [new TextEncoder().encode("A,B\n1,2\n")] }, {}, operation()))
      .rejects.toThrow("Unsupported file format");
  } finally { await engine.dispose(); }
});

it("selected text formats convert through SDK and CLI without admitting XLSX", async () => {
  const engine = createEngine({ formats: [textFormat] });
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  try {
    expect(engine.listServices("read").map(service => service.id)).toEqual(["Gnumeric_stf:stf_csvtab"]);
    const book = await engine.readWorkbook({ kind: "stream", filename: "input.csv",
      source: [new TextEncoder().encode("A,B\n1,2\n")] }, {}, operation());
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } },
      { exportType: "Gnumeric_stf:stf_csv" }, operation());
    expect(new TextDecoder().decode(output[0])).toContain("1,2");
    let writes = 0;
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { writes++; } } },
      { exportType: "Gnumeric_Excel:xlsx" }, operation())).rejects.toThrow("Unknown exporter 'Gnumeric_Excel:xlsx'");
    expect(writes).toBe(0);
    output.length = 0;
    expect(await runCommand(["--list-exporters"], engine, { ...operation(),
      stdout: { async write(bytes) { output.push(bytes); } }, stderr: { async write(bytes) { errors.push(bytes); } }
    })).toEqual({ exitCode: 0 });
    const listing = errors.map(bytes => new TextDecoder().decode(bytes)).join("");
    expect(listing).toContain("Gnumeric_stf:stf_csv");
    expect(listing).not.toContain("Gnumeric_Excel");
    expect(output).toEqual([]);
  } finally { await engine.dispose(); }
});

it("selection and metadata are owned while custom codecs override only their direction", async () => {
  const extensions = ["fixture"];
  const services: FormatProvider["services"][number][] = [
    { id: "table", direction: "read", description: "selected", extensions, read: async () => ({ sheets: [] }) },
    { id: "table", direction: "write", description: "selected", extensions, write: async () => new Uint8Array() }
  ];
  const formats: FormatProvider[] = [{ id: "fixture", source: "host", services }];
  const codecs: Codec[] = [{ id: "fixture:table", description: "override", extensions: [], read: async () => ({ sheets: [] }) }];
  const engine = createEngine({ formats, codecs });
  formats.push(textFormat); services.length = 0; extensions.push("xlsx"); codecs.length = 0;
  try {
    expect(engine.listServices("read").map(service => [service.id, service.extensions])).toEqual([["fixture:table", ["fixture"]]]);
    expect(engine.listServices("write").map(service => service.id)).toEqual(["fixture:table"]);
  } finally { await engine.dispose(); }
});

it("rejects colliding format services instead of silently selecting one", () => {
  expect(() => createEngine({ formats: [textFormat, textFormat] })).toThrow("Duplicate or empty codec ID");
});

it("XLSX is independently selectable from BIFF and SpreadsheetML", async () => {
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    expect(engine.listServices("read").map(service => service.id)).toEqual(["Gnumeric_Excel:xlsx"]);
    expect(engine.listServices("write").map(service => service.id)).toEqual(["Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2"]);
  } finally { await engine.dispose(); }
});

it("keeps the existing complete default format set when selection is omitted", async () => {
  const engine = createEngine();
  try {
    expect(engine.listServices("read").some(service => service.id === "Gnumeric_Excel:xlsx")).toBe(true);
    expect(engine.listServices("write").some(service => service.id === "Gnumeric_OpenCalc:odf")).toBe(true);
  } finally { await engine.dispose(); }
});

it("the shell command captures selected formats when bound, before execution", async () => {
  const services = textFormat.services.map(service => ({ ...service, extensions: [...service.extensions] }));
  const formats: FormatProvider[] = [{ ...textFormat, services }];
  const command = createSsconvertCommand({ formats });
  formats.length = 0;
  services[0]!.extensions.push("xlsx");
  services.length = 0;
  const output: Uint8Array[] = [];
  const result = await command.execute({ command: "ssconvert", ...createCommandArguments(["--list-importers"]),
    cwd: "/", env: {}, fs: new MemoryFileSystem(), ...operation(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes) { output.push(bytes.slice()); } }
  });
  expect(result.exitCode).toBe(0);
  const listing = output.map(bytes => new TextDecoder().decode(bytes)).join("");
  expect(listing).toContain("Gnumeric_stf:stf_csvtab");
  expect(listing).not.toContain("Gnumeric_Excel");
});
