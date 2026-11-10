import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const pixels = Buffer.from(Array.from({ length: 36 }, (_, i) => (7 * i + 1) % 256));

// Formatting-only observations from ImageMagick 7.1.2-35 Q16-HDRI.
describe.each(["command", "sync"] as const)("current interlace formatting (%s)", mode => {
  it.each([
    { options: [], expected: "None/" },
    { options: ["+interlace"], expected: "Undefined/undefined" },
    { options: ["-interlace", "Plane", "+interlace"], expected: "Undefined/undefined" },
    { options: ["+interlace", "-interlace", "None"], expected: "None/None" }
  ])("reports the option interlace value for $options", async ({ options, expected }) => {
    const argv = ["xc:#204080", "xc:#305090", "+append", ...options, "-format", "%[interlace]/%[option:interlace]", "info:-"];
    expect(await run(mode, argv, false)).toEqual({
      exitCode: 0, stdout: expected,
      stderr: options.length ? "" : "magick: unknown image property '%[option:interlace]'\n"
    });
  });

  it.each([
    { progressive: false, options: [], expected: "None" },
    { progressive: true, options: [], expected: "PNG" },
    ...[false, true].flatMap(progressive => [
      ...["Plane", "Line", "PNG", "GIF", "None"].map(value => ({ progressive, options: ["-interlace", value], expected: value })),
      { progressive, options: ["-interlace", "pLaNe"], expected: "Plane" },
      { progressive, options: ["+interlace"], expected: "Undefined" },
      { progressive, options: ["-interlace", "Plane", "+interlace"], expected: "Undefined" }
    ])
  ])("reports $expected for $options (progressive=$progressive)", async ({ progressive, options, expected }) => {
    const result = await run(mode, ["/in.png", ...options, "-format", "%[interlace]|%[INTERLACE]", "info:"], progressive);
    expect(result).toEqual({ exitCode: 0, stdout: `${expected}|${expected}`, stderr: "" });
  });

  it.each([
    { argv: ["-interlace", "Plane", "/in.png", "-format", "%[interlace]", "info:"], expected: "Plane" },
    { argv: ["/in.png", "-interlace", "Plane", "/in.png", "-format", "%[interlace]|", "info:"], expected: "Plane|Plane|" },
    { argv: ["/in.png", "-interlace", "Plane", "-set", "label", "%[interlace]", "+interlace", "-set", "comment", "%[interlace]", "-interlace", "Line", "-format", "%[label]|%[comment]|%[interlace]", "info:"], expected: "Plane|Undefined|Line" },
    { argv: ["/in.png", "-interlace", "Plane", "-set", "label", "%[interlace]", "-interlace", "Line", "-format", "%[label]|%[interlace]", "info:"], expected: "Plane|Line" }
  ])("preserves option order: $expected", async ({ argv, expected }) => {
    expect(await run(mode, argv, false)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
});

async function run(mode: "command" | "sync", argv: string[], progressive: boolean) {
  const input = await sharp(pixels, { raw: { width: 3, height: 4, channels: 3 } }).png({ progressive }).toBuffer();
  let result;
  if (mode === "sync") {
    result = runMagickCliSync(argv, new Map([["/in.png", input]]));
  } else {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const commandResult = await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    result = { ...commandResult, stdout, stderr };
  }
  return result;
}
