import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// Native ImageMagick: magick -size 8x8 xc:white -depth 8 -strip png:-
const opaque = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAADElEQVQI12P4z4ACAT/QB/mI84VSAAAAAElFTkSuQmCC", "base64");
const translucent = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAQAAABuBnYAAAAAE0lEQVQI12P838CAApgYGAZCAADOQQGPkD6v/QAAAABJRU5ErkJggg==", "base64");
const cases = [
  { args: ["-fill", "red", "-draw", "rectangle 1,1 6,6"], point: [3, 3], pixel: [255, 0, 0, 255] },
  { args: ["-fill", "blue", "-draw", "rectangle 1,1 6,6"], point: [3, 3], pixel: [0, 0, 255, 255] },
  { args: ["-draw", "fill red circle 3,3 5,3"], point: [3, 3], pixel: [255, 0, 0, 255] },
  { args: ["-draw", "fill red polygon 1,1 6,1 6,6 1,6"], point: [3, 3], pixel: [255, 0, 0, 255] },
  { args: ["-draw", "fill none stroke blue stroke-width 2 rectangle 1,1 6,6"], point: [1, 3], pixel: [0, 0, 255, 255] },
  { args: ["-draw", "fill red color 3,3 floodfill"], point: [3, 3], pixel: [255, 0, 0, 255] },
];
for (const mode of ["map", "command"] as const)
for (const base of [opaque, translucent])
it.each(cases)(`${mode}, PNG type ${base[25]}: preserves colored drawing on grayscale PNG: $args`, async ({ args, point, pixel }) => {
  expect([0, 4]).toContain(base[25]);
  const files = new Map<string, Uint8Array>([["/base.png", base]]), fs = new MemoryFileSystem();
  await fs.writeFile("/base.png", base);
  const argv = ["/base.png", ...args, "/out.png"];
  let stderr = "";
  const result = mode === "map" ? await runConvertCli(argv, files) : await createConvertCommand().execute({
    command: "convert", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  const bytes = mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png");
  const output = decodeImage(bytes), offset = (point[1]! * output.width + point[0]!) * 4;
  expect(Array.from(output.data.subarray(offset, offset + 4))).toEqual(pixel);
  expect([2, 3, 6]).toContain(bytes[25]);
  if (!args.join(" ").includes("floodfill")) {
    const corner = args.join(" ").includes("stroke blue")
      ? base === opaque ? [226, 226, 255, 255] : [203, 203, 255, 142]
      : [255, 255, 255, base === opaque ? 255 : 128];
    expect(Array.from(output.data.subarray(0, 4))).toEqual(corner);
  }
});
