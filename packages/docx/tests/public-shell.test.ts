import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { expect, it } from "vitest";

it("runs built public SDK and shell consumers outside source aliases", () => {
  const code = transformSync(readFileSync(new URL("./public-shell.cases.ts", import.meta.url), "utf8"), {
    loader: "ts", format: "esm", target: "es2022"
  }).code;
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: code, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("# tests 8");
});
