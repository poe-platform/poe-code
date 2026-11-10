import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

it.each([
  { input: "xc:#804020", options: ["-channel", "R"], expression: "minima", expected: "0.501961" },
  { input: "xc:#804020", options: ["-channel", "G"], expression: "maxima", expected: "0.25098" },
  { input: "in.ppm", options: ["-channel", "R"], expression: "standard_deviation", expected: "0.288841" },
  { input: "xc:#804020", options: ["-channel", "K"], expression: "minima", expected: "2.7431e+303" },
  { input: "xc:#804020", options: ["-channel", "K"], expression: "maxima", expected: "-2.7431e+303" },
  { input: "xc:#804020", options: ["-channel", "K"], expression: "standard_deviation", expected: "0" },
  { input: "xc:#804020", options: ["-channel", "R"], expression: "mean", expected: "0.501961" },
  { input: "xc:#804020", options: [], expression: "minima", expected: "0.12549" },
  { input: "in.ppm", options: [], expression: "standard_deviation", expected: "0.282329" },
  { input: "in.ppm", options: ["-channel", "R", "+channel"], expression: "standard_deviation", expected: "0.282329" },
])("formats $expression for $input with $options", async ({ input, options, expression, expected }) => {
  // ImageMagick 7 Q16-HDRI reference output, including empty-channel extrema.
  const fs = new MemoryFileSystem();
  const header = new TextEncoder().encode("P6\n5 5\n255\n");
  const pixels = Array.from({ length: 25 }, (_, i) => [(i * 37 + 19) % 256, (i * 17 + 23) % 256, (i * 59 + 5) % 256]).flat();
  await fs.writeFile("/in.ppm", new Uint8Array([...header, ...pixels]));
  const argumentValues = createCommandArguments([input, "-colorspace", "sRGB", ...options, "-format", `%[fx:${expression}]`, "info:-"]);
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
