import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "@poe-code/spreadsheet-format-csv";
import { odsFormat } from "@poe-code/spreadsheet-format-ods";
import { createCommandArguments } from "safe-bash-contracts/command";
import { toByteSource } from "safe-bash-contracts/io";
import { createSsconvertCommand } from "../commands.js";

it.each(["openoffice", "odf"])("publishes %s ODF through the command stream", async edition => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("Name,Value\na,1.25\n"));
  const readFile = fs.readFile.bind(fs), buffered = vi.fn(() => { throw new Error("buffered exporter"); });
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole file read"));
  const writeStream = vi.spyOn(fs, "writeStream");
  const formats = [csvFormat, { ...odsFormat, services: odsFormat.services.map(codec => codec.direction === "write" ? { ...codec, write: buffered } : codec) }];
  const args = createCommandArguments(["-I", "Gnumeric_stf:stf_csvtab", "-T", `Gnumeric_OpenCalc:${edition}`, "/input.csv", "/output.ods"]);
  const cleanups: (() => void | Promise<void>)[] = [], errors: string[] = [];
  const signal = new AbortController().signal;
  try {
    const result = await createSsconvertCommand({ formats }).execute({ command: "ssconvert", args: args.args, argumentValues: args,
      cwd: "/", env: {}, fs, signal, stdin: toByteSource(""), stdout: { async write() {} },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }, registerCleanup(cleanup) { cleanups.push(cleanup); } });
    expect(result, errors.join("")).toMatchObject({ exitCode: 0 });
    expect(buffered).not.toHaveBeenCalled(); expect(writeStream).toHaveBeenCalledOnce();
    const engine = createEngine({ formats: [odsFormat] });
    try {
      const book = await engine.readWorkbook({ kind: "stream", filename: "output.ods", source: [await readFile("/output.ods")] }, {}, { signal });
      expect(book.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)?.value).toMatchObject({ kind: "number", value: 1.25 });
    } finally { await engine.dispose(); }
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input.csv", "output.ods"]);
});
