import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync, runIdentifyCli } from "./index.js";

// Native PNG24 with RightTop in orNT, without an EXIF profile.
const pngWithoutExif = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAAW9yTlQGUcbiOQAAAA9JREFUCNdj+M/AwMDwHwAHAAH/dtWnYAAAAABJRU5ErkJggg==", "base64");
const format = "%[orientation]/%[EXIF:Orientation]/%wx%h";

for (const mode of ["buffered", "sync", "retained", "command"]) {
  it.each([
    { name: "explicit orientation without EXIF", input: "xc:red", options: ["-orient", "RightTop"], expected: "RightTop//1x1" },
    { name: "PNG orientation without EXIF", input: "/input.png", options: [], expected: "RightTop//2x1" },
    { name: "present EXIF tag", input: "/input.jpg", options: [], expected: "RightTop/6/3x2" },
    { name: "stripped EXIF", input: "/input.jpg", options: ["-strip"], expected: "RightTop//3x2" },
    { name: "removed EXIF", input: "/input.jpg", options: ["+profile", "exif"], expected: "RightTop//3x2" },
    { name: "removed profiles", input: "/input.jpg", options: ["+profile", "*"], expected: "RightTop//3x2" },
    { name: "auto-orient with EXIF", input: "/input.jpg", options: ["-auto-orient"], expected: "TopLeft/1/2x3" },
    { name: "auto-orient after strip", input: "/input.jpg", options: ["-strip", "-auto-orient"], expected: "TopLeft//2x3" },
    { name: "auto-orient after profile removal", input: "/input.jpg", options: ["+profile", "exif", "-auto-orient"], expected: "TopLeft//2x3" }
  ])(`${mode}: $name`, async ({ input, options, expected }) => {
    const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const files = new Map<string, Uint8Array>([["/input.jpg", jpeg], ["/input.png", pngWithoutExif]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [input, ...options, "-format", format, "info:/output"];
    if (mode === "command") {
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode).toBe(0);
      expect(stderr).toBe("");
    } else {
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "buffered" || mode === "sync" ? files.get("/output")! : await fs.readFile("/output");
    expect(new TextDecoder().decode(output)).toBe(expected);
  });
}

it("identifies image orientation without inventing an EXIF tag", async () => {
  expect(await runIdentifyCli(["-format", format, "/input.png"], new Map([["/input.png", pngWithoutExif]])))
    .toEqual({ exitCode: 0, stdout: "RightTop//2x1", stderr: "" });
});
