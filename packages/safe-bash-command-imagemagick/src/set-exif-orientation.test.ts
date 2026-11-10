import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const fixture = encodeImage({
  width: 3, height: 2, format: "jpeg", space: "srgb", channels: 3,
  depth: "uchar", density: 72, hasAlpha: false, orientation: 6,
  data: Uint8Array.from([16, 32, 48, 64, 80, 96].flatMap(value => [value, value, value, 255]))
}, { format: "jpeg", quality: 99 }).data;

// Expected property values from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { input: "xc:red", options: ["-set", "EXIF:Orientation", "4"], expected: "Undefined/4" },
    { input: "/grid.jpg", options: ["-set", "exif:Orientation", "4"], expected: "RightTop/4" },
    { input: "/grid.jpg", options: ["-set", "eXiF:oRiEnTaTiOn", ""], expected: "RightTop/" },
    { input: "/grid.jpg", options: [], expected: "RightTop/6" },
    { input: "/grid.jpg", options: ["-auto-orient"], expected: "TopLeft/1" },
    { input: "/grid.jpg", options: ["-set", "EXIF:Orientation", "4", "+set", "exif:Orientation"], expected: "RightTop/6" }
  ])(`formats the explicit EXIF orientation property (${mode}): $options $input`, async ({ input, options, expected }) => {
    const files = new Map([["/grid.jpg", fixture]]), fs = new MemoryFileSystem();
    await fs.writeFile("/grid.jpg", fixture);
    const args = [input, ...options, "-format", "%[orientation]/%[EXIF:Orientation]", "info:-"];
    const argumentValues = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}

for (const retained of [false, true]) {
  it(`preserves JPEG pixels and physical orientation after a text override (retained=${retained})`, async () => {
    const outputs: Uint8Array[] = [];
    for (const options of [[], ["-set", "EXIF:Orientation", "4"]]) {
      const files = new Map([["/grid.jpg", fixture]]), fs = new MemoryFileSystem();
      await fs.writeFile("/grid.jpg", fixture);
      expect(await runMagickCli(["/grid.jpg", ...options, "/out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      outputs.push(retained ? await fs.readFile("/out.jpg") : files.get("/out.jpg")!);
    }
    const control = decodeImage(outputs[0]!);
    const overridden = decodeImage(outputs[1]!);
    expect(overridden).toMatchObject({ width: 3, height: 2, orientation: 6, data: control.data });
  });
}
