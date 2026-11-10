import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Independently encoded PNG: LittleCMS sRGB profile, EXIF Make/Model, 4x3 RGBA pixels.
const tagged = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAABeGlDQ1BJQ0MgUHJvZmlsZQAAeJx1kb9Lw0AUx79tlUpb6aCgSIcMVRxaEAVx1Dp0KVJqBasuyTVphSQNlxQproKLQ8FBdPHX4H+gq+CqIAiKIOLs6K9FSnzXFFqkvfDyPnzvvo937wB/RmeG3TcPGKbDc+mUtFpYk4LvCCOEEYqYzGxrIZvNoOf6eYRP5IekqNX7XNcVLqo2A3wDxLPM4g4xdYPMlmMJ3iMeZmW5SHxCnODUIPGt0BWP3wSXPP4SzPO5RcAvakqlDlY6mJW5QTxJHDf0Kmv1I24SUc2VZcpjFDHYyCGNFCQoqGITOhwkKZs0s+6+qaZvCRXyMPpbqIGTo4QyeROkVqmqSlkjXaVPR03M/f88bW1m2qseSQH9r677OQ4E94FG3XV/T123cQYEXoBrs+2v0Jzmvkmvt7X4MRDdAS5v2ppyAFztAqPPlszlphSg8Gsa8HEBDBaAoXsgtO7NqrWP8ycgv01PdAccHgETdD668Qfr8WgA7MZviQAAADxlWElmSUkqAAgAAAACAA8BAgANAAAAJgAAABABAgAJAAAAMwAAAAAAAABQYXJpdHlDYW1lcmEATW9kZWxPbmUA/Lo7IQAAADNJREFUeJwNyKERAEAIA8F0gKEXNJVgTn9DFMtHZC6zykAd8IJbT1lcl8HdQsoxjGHQ+n+xWBKFFoQJIwAAAABJRU5ErkJggg==", "base64");
const plain = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAM0lEQVR4nA3IoREAQAgDwXSAoRc0lWBOf0MUy0dkLrPKQB3wgltPWVyXwd1CyjGMYdD6f7FYEoUWhAkjAAAAAElFTkSuQmCC", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const identify of [false, true]) {
    it.each([
      { input: tagged, options: [], expected: "sRGB built-in" },
      { input: plain, options: [], expected: "" },
      { input: tagged, options: ["+profile", "icc"], expected: "" },
      { input: tagged, options: ["-strip"], expected: "" },
      { input: tagged, options: ["-set", "icc:description", "override"], expected: "override" }
    ].filter(test => !identify || (test.input === tagged && test.options.length === 0)))(
      `reads embedded ICC description (${mode}, identify=${identify}): $options, $expected`,
      async ({ input, options, expected }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const format = "%[icc:description]|%[ICC:Description]";
        const args = identify ? ["identify", "-quiet", "-format", format, "/input.png"]
          : ["-quiet", "/input.png", ...options, "-format", format, "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map([["/input.png", input]]))
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", input]]));
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
          .toEqual({ exitCode: 0, stdout: `${expected}|${expected}`, stderr: "" });
      }
    );
  }
}

it("preserves the ICC bytes, EXIF Make/Model and raster on a plain public-command PNG32 rewrite", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", tagged);
  const argumentValues = createCommandArguments(["input.png", "PNG32:-"]);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
  const output = Buffer.concat(chunks);
  const original = decodeImage(tagged), rewritten = decodeImage(output);
  expect(original.icc).toHaveLength(588);
  expect(original.exif).toHaveLength(60);
  expect(rewritten).toMatchObject({ width: 4, height: 3, icc: original.icc, exif: original.exif });
  expect(rewritten.data).toEqual(original.data);
  expect(runMagickCliSync(["/output.png", "-format", "%[exif:Make]|%[exif:Model]", "info:"], new Map([["/output.png", output]])))
    .toEqual({ exitCode: 0, stdout: "ParityCamera|ModelOne", stderr: "" });
});
