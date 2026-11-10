import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { formatSignificantMetric } from "./compare-kernel.js";
import { createMagickCommand, runIdentifyCli, runMagickCli } from "./index.js";

it.each([
  ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPg4uL6DwABXgEe7ObnCAAAAABJRU5ErkJggg==", "18311.2"],
  ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPg4eH5DwABcAEkntN06wAAAABJRU5ErkJggg==", "18696.8"]
])("rounds exact RGBA mean ties to even (%s)", async (base64, expected) => {
  const bytes = Buffer.from(base64, "base64");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const args = ["-format", "%[mean]", "/input.png"];
  for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(args, input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    expect(await runMagickCli(["/input.png", "-format", "%[mean]", "info:"], input))
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  }
  const argumentValues = createCommandArguments(["identify", ...args]);
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});

it.each([
  [18311.25, 6, "18311.2"], [18696.75, 6, "18696.8"],
  [-18311.25, 6, "-18311.2"], [-18696.75, 6, "-18696.8"],
  [18311.25 - 2 ** -38, 6, "18311.2"], [18311.25 + 2 ** -38, 6, "18311.3"],
  [1.15, 2, "1.1"], [1.85, 2, "1.9"], [1.25, 2, "1.2"],
  [1234565, 6, "1.23456e+06"], [1234575, 6, "1.23458e+06"],
  [-1234565, 6, "-1.23456e+06"], [999999.5, 6, "1e+06"],
  [0.00006103515625, 10, "6.103515625e-05"],
  [0.00006103515625, 9, "6.10351562e-05"],
  [0.1000003814697265625, 18, "0.100000381469726562"]
])("formats %s at precision %s with native rounding", (value, precision, expected) => {
  expect(formatSignificantMetric(value, precision)).toBe(expected);
});
