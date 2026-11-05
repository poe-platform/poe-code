import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSsconvertCommand } from "./commands.js";
import { distributionValue } from "./formulas/functions/probability.js";
import type { FunctionHost } from "./formulas/functions/types.js";
import { csvFormat } from "./formats/csv.js";

// Native Gnumeric 1.12.62 CSV output, including the zero-count control.
it("exports Poisson probabilities with Gnumeric precision", async () => {
  const formulas = ["=POISSON(1,3,FALSE)", "=POISSON(2,3,FALSE)",
    "=POISSON(3,3,FALSE)", "=POISSON(2,3,TRUE)", "=POISSON(0,3,FALSE)"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode(formulas.map(formula => `"${formula}"`).join("\n") + "\n"));
  const result = await createSsconvertCommand({ formats: [csvFormat] }).execute({
    command: "ssconvert", cwd: "/", env: {}, fs,
    ...createCommandArguments(["-I", "Gnumeric_stf:stf_csvtab", "-T", "Gnumeric_stf:stf_csv", "/input.csv", "/output.csv"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/output.csv"))).toBe("0.14936120510359183\n0.22404180765538775\n0.22404180765538775\n0.42319008112684353\n0.049787068367863944\n");
});

const host = { tick() {} } as FunctionHost;
it.each([
  ["d", 0, 0, 1], ["d", 1, 0, 0], ["d", -1, 3, 0], ["d", 1.5, 3, 0],
  ["p", -1, 3, 0], ["p", 1, 0, 1], ["p", Infinity, 3, 1],
] as const)("preserves Poisson %s(%s, %s) boundaries", (operation, x, mean, expected) => {
  expect(distributionValue("pois", operation, x, [mean], true, false, host)).toBe(expected);
});
it.each([[2,3], [3,3], [4,3], [2.9,3], [2,.5], [100,100], [140,140], [141,140], [140,141]] as const)(
  "keeps Poisson tails and log probabilities consistent at %s, %s", (x, mean) => {
    const lower = distributionValue("pois", "p", x, [mean], true, false, host);
    const upper = distributionValue("pois", "p", x, [mean], false, false, host);
    expect(lower + upper).toBeCloseTo(1, 14);
    expect(lower).toBeGreaterThan(0);
    expect(lower).toBeLessThan(1);
    expect(Math.log(lower)).toBeCloseTo(distributionValue("pois", "p", x, [mean], true, true, host), 11);
  }
);
it("charges Poisson series work to the host budget", () => {
  const reason = new Error("budget exhausted");
  expect(() => distributionValue("pois", "p", 4, [3], true, false, {
    tick() { throw reason; }
  } as FunctionHost)).toThrow(reason);
});
