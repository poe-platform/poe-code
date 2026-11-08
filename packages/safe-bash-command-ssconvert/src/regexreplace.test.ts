import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSsconvertCommand } from "./commands.js";
import { csvFormat } from "./formats/csv.js";

it("evaluates native REGEXREPLACE formulas through CSV conversion", async () => {
  const formulas = ['=REGEXREPLACE("abc123","[0-9]+","X")',
    '=REGEXREPLACE("a1b2","[0-9]","X")', '=REGEXREPLACE("abc","z","X")',
    '=REGEXMATCH("abc123","[0-9]+")'];
  const csv = formulas.map(formula => 'x,"' + formula.replaceAll('"', '""') + '"').join("\n") + "\n";
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode(csv));
  const diagnostics: Uint8Array[] = [];
  const result = await createSsconvertCommand({ formats: [csvFormat] }).execute({
    command: "ssconvert", cwd: "/", env: {}, fs,
    ...createCommandArguments(["-I", "Gnumeric_stf:stf_csvtab", "-T", "Gnumeric_stf:stf_csv", "/input.csv", "/output.csv"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { diagnostics.push(bytes); } }
  });
  expect(result.exitCode, diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(0);
  expect(diagnostics).toEqual([]);
  expect(new TextDecoder().decode(await fs.readFile("/output.csv"))).toBe("x,abcX\nx,aXbX\nx,abc\nx,#NAME?\n");
});
