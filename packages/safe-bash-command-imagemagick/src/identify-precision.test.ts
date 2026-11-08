import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli } from "./index.js";

const inputs = [
  ["iVBORw0KGgoAAAANSUhEUgAAAAIAAAACEAYAAAAiJtFnAAAAJ0lEQVR4nGMQYjBhDGNsYBRiNGEKY25gYhBiMmEGMYSYTVjC2BuYAUnLBJe8dy/XAAAAAElFTkSuQmCC", "18178.375|0.0703364614328", "1.82e+04|0.0703"],
  ["iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGMQMglrAGEGGAMAJSoEcezqGxAAAAAASUVORK5CYII=", "18247|0.0705882352941", "1.82e+04|0.0706"]
] as const;

it.each(inputs)("honors identify precision for property and FX statistics (%s)", async (base64, high, low) => {
  const bytes = Buffer.from(base64, "base64");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  for (const [precision, expected] of [["12", high], ["3", low]] as const) {
    const args = ["-precision", precision, "-format", "%[mean]|%[fx:mean.r]", "/input.png"];
    for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
      expect(await runIdentifyCli(args, input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
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
  }
});

it.each([[[]], [["oops"]], [[" "]]])("rejects invalid identify precision %j", async (operand) => {
  const result = await runIdentifyCli(["-precision", ...operand], new Map());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("argument for option '-precision'");
});

it.each([false, true])("uses significant digits for every formatted statistic (retained=%s)", async (retained) => {
  const bytes = Buffer.from(inputs[0][0], "base64");
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", bytes);
  const input = retained ? { filesystem, cwd: "/" } : new Map([["/input.png", bytes]]);
  const format = "%[mean]|%[min]|%[max]|%[median]|%[standard-deviation]|%[skewness]|%[kurtosis]|%[entropy]|%[fx:mean.r]";
  expect(await runIdentifyCli(["-precision", "3", "-format", format, "/input.png"], input))
    .toEqual({ exitCode: 0, stdout: "1.82e+04|4.61e+03|3.28e+04|1.82e+04|1.48|0.106|-1.96|0.973|0.0703", stderr: "" });
  for (const options of [[], ["-precision", "0"], ["-precision", "-1"]]) {
    expect(await runIdentifyCli([...options, "-format", "%[mean]|%[fx:mean.r]", "/input.png"], input))
      .toEqual({ exitCode: 0, stdout: "18178.4|0.0703365", stderr: "" });
  }
});
