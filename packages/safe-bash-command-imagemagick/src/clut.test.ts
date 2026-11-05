import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// RGB PNGs and expected pixels verified with native ImageMagick 7.1.2.
const samples = [
  { png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADElEQVQI12NgIB0AAAA0AAGnfbGcAAAAAElFTkSuQmCC", expected: [255, 0, 0, 255] },
  { png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVQI12NsaGhggAEmBiSAmwMATAQBiIM5jtEAAAAASUVORK5CYII=", expected: [127, 0, 128, 255] },
  { png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVQI12P8//8/AwwwMSAB3BwAlm4DBdoYksUAAAAASUVORK5CYII=", expected: [0, 0, 255, 255] },
];

for (const mode of ["map", "command"] as const)
for (const vertical of [false, true])
it.each(samples)(`${mode}: interpolates CLUT endpoints and midpoint, vertical=${vertical}, $expected`, async ({ png, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  files.set("/base.png", Buffer.from(png, "base64"));
  files.set("/lut.png", await sharp(Uint8Array.of(255, 0, 0, 0, 0, 255), {
    raw: { width: vertical ? 1 : 2, height: vertical ? 2 : 1, channels: 3 },
  }).png().toBuffer());
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["/base.png", "/lut.png", "-clut", "/out.png"];
  let stderr = "";
  const result = mode === "map" ? await runConvertCli(args, files) : await createConvertCommand().execute({
    command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
  expect(output.data).toEqual(Uint8Array.from({ length: 64 }, (_, index) => expected[index % 4]!));
});
