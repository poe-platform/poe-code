import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSsconvertCommand } from "./commands.js";
import { csvFormat } from "./formats/csv.js";

// Native Gnumeric 1.12.62 CSV output, including the zero-success control.
it("exports binomial probabilities with Gnumeric precision", async () => {
  const formulas = ["=BINOMDIST(1,4,0.5,FALSE)", "=BINOMDIST(2,4,0.5,FALSE)",
    "=BINOMDIST(2,4,0.5,TRUE)", "=BINOMDIST(2,10,0.3,FALSE)", "=BINOMDIST(0,4,0.5,FALSE)"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode(formulas.map(formula => `"${formula}"`).join("\n") + "\n"));
  const result = await createSsconvertCommand({ formats: [csvFormat] }).execute({
    command: "ssconvert", cwd: "/", env: {}, fs,
    ...createCommandArguments(["-I", "Gnumeric_stf:stf_csvtab", "-T", "Gnumeric_stf:stf_csv", "/input.csv", "/output.csv"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/output.csv"))).toBe("0.25\n0.375\n0.6875\n0.23347444049999985\n0.0625\n");
});
