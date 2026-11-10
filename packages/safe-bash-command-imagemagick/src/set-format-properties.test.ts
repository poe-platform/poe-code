import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Equivalent to the native 3x2 red fixture with blue at 1,0, lime at 2,1,
// and a RightTop orientation tag. Expected outputs are from ImageMagick 7.1.2-35.
const fixture = encodeImage({
  width: 3, height: 2, format: "tiff", space: "srgb", channels: 3,
  depth: "uchar", density: 72, hasAlpha: false, orientation: 6,
  data: Uint8Array.of(
    255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255
  )
}, { format: "tiff" }).data;

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { input: "RightTop.tif", options: ["-set", "orientation", "marker", "-auto-orient"], format: "%wx%h %g %[orientation];", expected: "2x3 2x3+0+0 marker;" },
    { input: "xc:#73889a", options: ["-set", "orientation", "RightTop"], format: "%w/%h/%[orientation];", expected: "1/1/RightTop;" },
    { input: "xc:#73889a", options: ["-set", "scene", "frame-A"], format: "%s|%[scene]|%p;", expected: "0|frame-A|0;" },
    { input: "xc:#73889a", options: ["-set", "scene", "4"], format: "%s|%[scene]|%p;", expected: "0|4|0;" },
    { input: "RightTop.tif", options: ["-set", "orientation", "marker", "+set", "orientation", "-auto-orient"], format: "%wx%h %g %[orientation];", expected: "2x3 2x3+0+0 TopLeft;" },
    { input: "xc:#73889a", options: ["-set", "orientation", "RightTop", "+set", "orientation"], format: "%w/%h/%[orientation];", expected: "1/1/Undefined;" },
    { input: "xc:#73889a", options: ["-set", "scene", "frame-A", "+set", "scene"], format: "%s|%[scene]|%p;", expected: "0|0|0;" },
    { input: "xc:#73889a", options: ["-set", "orientation", ""], format: "%[orientation];", expected: ";" },
    { input: "xc:#73889a", options: ["-set", "scene", ""], format: "%s|%[scene]|%p;", expected: "0||0;" },
    { input: "RightTop.tif", options: ["-set", "orientation", "marker", "-auto-orient", "-depth", "8"], format: undefined, expected: "ff0000ff0000ff00000000ff00ff00ff0000" },
    { input: "RightTop.tif", options: ["-set", "orientation", "TopLeft", "-auto-orient", "-depth", "8"], format: undefined, expected: "ff0000ff0000ff00000000ff00ff00ff0000" }
  ])(`formats explicit properties without changing image tags (${mode}): $options`, async ({ input, options, format, expected }) => {
    const files = new Map([["RightTop.tif", fixture], ["out", new TextEncoder().encode("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = [input, ...options, ...(format === undefined ? ["rgb:out"] : ["-format", format, "info:out"])];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    if ("stderr" in result) stderr = String(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
    expect(format === undefined ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output)).toBe(expected);
  });
}
