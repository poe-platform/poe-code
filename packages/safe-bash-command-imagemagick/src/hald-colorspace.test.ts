import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// PNG inputs and expected results captured with native ImageMagick 7.1.2-35 Q16-HDRI.
const source = "iVBORw0KGgoAAAANSUhEUgAAAAUAAAABCAIAAACZnPOkAAAAGElEQVR4nGNgcPjv0HCgVuTVgjtR/2sZADlZB40a4DkbAAAAAElFTkSuQmCC";
const cube = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAXElEQVR4nB2NsQEAIAzC+iRP8iQmdlApAe9217ucs1xzydfrtZfqb9ddYP/JEkhsSeOgsqZ1QcuWYtL4ozS5pmsyUiS6OtHtEDTw7fzP2zBvi+0iASQWKzcVLvADM0lfoV1S878AAAAASUVORK5CYII=";
const lut = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAFUlEQVR4nGNgENGJ+mB0T+jX/xM2ABzoBaqNPZlHAAAAAElFTkSuQmCC";

for (const mode of ["map", "command"] as const)
it.each([
  { operation: [], output: ["-format", "%[colorspace]", "info:"], colorspace: "RGB" },
  { operation: ["/lut.png", "-clut"], output: ["-format", "%[colorspace]", "info:"], colorspace: "RGB" },
  { operation: ["/cube.png", "-hald-clut"], output: ["-format", "%[colorspace]", "info:"], colorspace: "sRGB" },
  { operation: ["/cube.png", "-hald-clut"], output: ["-colorspace", "sRGB", "PNG24:/out.png"] },
])(`${mode}: uses Hald output colorspace after linear RGB input: $operation $output`, async ({ operation, output, colorspace }) => {
  const files = new Map([
    ["/source.png", Buffer.from(source, "base64")],
    ["/cube.png", Buffer.from(cube, "base64")],
    ["/lut.png", Buffer.from(lut, "base64")],
  ]);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["/source.png", "-colorspace", "RGB", ...operation, ...output];
  let stdout = "", stderr = "";
  let result;
  if (mode === "map") {
    result = await runMagickCli(args, files);
    stdout = result.stdout;
    stderr = result.stderr;
  } else result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  if (colorspace) expect(stdout.trim()).toBe(colorspace);
  else {
    expect(stdout).toBe("");
    const image = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(image.data).toEqual(Uint8Array.of(
      255, 255, 13, 255, 134, 242, 55, 255, 210, 203, 2, 255,
      26, 165, 183, 255, 0, 0, 52, 255,
    ));
  }
});
