import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSsconvertCommand } from "./commands.js";
import { csvFormat } from "./formats/csv.js";

it("coerces direct aggregate text while ignoring referenced text through CSV conversion", async () => {
  const formulas = ['=COUNT("2")', '=COUNT(1,"2",3)', '=COUNT("x")', '=COUNT(1,"x",2)',
    '=SUM(1,"x",2)', '=AVERAGE(1,"x",2)', '=COUNT(1,2)', '=COUNT(A8)', '=SUM(A9)', '=AVERAGE(A10)'];
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
  expect(new TextDecoder().decode(await fs.readFile("/output.csv"))).toBe("x,1\nx,3\nx,#VALUE!\nx,#VALUE!\nx,#VALUE!\nx,#VALUE!\nx,2\nx,0\nx,0\nx,#DIV/0!\n");
});
