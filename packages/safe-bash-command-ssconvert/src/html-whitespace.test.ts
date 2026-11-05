import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSsconvertCommand } from "./commands.js";
import { htmlFormat } from "@poe-code/spreadsheet-format-html";
import { csvFormat } from "./formats/csv.js";

it.each([
  ["<html>\n<body><table><tr><td>A</td></tr></table></body></html>", ',"\n"\nA,\n'],
  ["<html><body><table><tr><td>A</td></tr></table></body></html>", "A\n"],
  ["<html><body>\n<table><tr><td>A</td></tr></table>\n</body></html>", ',"\n"\nA,\n,"\n"\n']
])("imports document whitespace through ssconvert: %j", async (html, csv) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.html", new TextEncoder().encode(html));
  const diagnostics: Uint8Array[] = [];
  const result = await createSsconvertCommand({ formats: [htmlFormat, csvFormat] }).execute({
    command: "ssconvert", cwd: "/", env: {}, fs,
    ...createCommandArguments(["-I", "Gnumeric_html:html", "-T", "Gnumeric_stf:stf_csv", "/input.html", "/output.csv"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { diagnostics.push(bytes); } }
  });
  expect(result.exitCode, diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(0);
  expect(diagnostics).toEqual([]);
  expect(new TextDecoder().decode(await fs.readFile("/output.csv"))).toBe(csv);
});
