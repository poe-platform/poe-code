import {expect, it} from "vitest";
import {createMemoryFileSystem, createOverlayFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments, type CommandContext} from "safe-bash-contracts/command";
import {toByteSource} from "safe-bash-contracts/io";
import {createSsconvertCommand} from "./commands.js";
import {csvFormat, xlsxFormat} from "./index.js";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";

it.each(["absent", "lower", "upper"] as const)("publishes XLSX to an overlay with %s output", async existing => {
  const lower = createMemoryFileSystem(), upper = createMemoryFileSystem();
  const encode = (text: string) => new TextEncoder().encode(text);
  await lower.writeFile("/data.csv", encode("Name,Count\nApple,7\n"));
  if (existing !== "absent") await (existing === "lower" ? lower : upper).writeFile("/data.xlsx", encode("original"));
  const fs = createOverlayFileSystem({lower, upper});
  const args = createCommandArguments(["/data.csv", "/data.xlsx"]);
  const errors: string[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const context: CommandContext = {command: "ssconvert", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}},
    stderr: {async write(bytes) {errors.push(new TextDecoder().decode(bytes));}}, registerCleanup(cleanup) {cleanups.push(cleanup);}};
  try {
    expect(await createSsconvertCommand({formats: [csvFormat, xlsxFormat]}).execute(context), errors.join("")).toMatchObject({exitCode: 0});
    const parts = readZipArchiveEntries(await fs.readFile("/data.xlsx"));
    expect(parts.has("xl/workbook.xml")).toBe(true);
    expect(new TextDecoder().decode(parts.get("xl/worksheets/sheet1.xml"))).toContain("7");
    expect(await upper.readFile("/data.xlsx")).toEqual(await fs.readFile("/data.xlsx"));
    if (existing === "lower") expect(new TextDecoder().decode(await lower.readFile("/data.xlsx"))).toBe("original");
  } finally {for (const cleanup of cleanups.reverse()) await cleanup();}
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["data.csv", "data.xlsx"]);
});
