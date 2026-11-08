import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// PNGs and expected RGBA pixels captured with native ImageMagick 7.1.2.
const base = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVQI12N0aDjAAANMDEgANwcAS4QBiNXq4ZgAAAAASUVORK5CYII=";
const identity = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAMAAADz0U65AAAAwFBMVEUAAABVAACqAAD/AAAAVQBVVQCqVQD/VQAAqgBVqgCqqgD/qgAA/wBV/wCq/wD//wAAAFVVAFWqAFX/AFUAVVVVVVWqVVX/VVUAqlVVqlWqqlX/qlUA/1VV/1Wq/1X//1UAAKpVAKqqAKr/AKoAVapVVaqqVar/VaoAqqpVqqqqqqr/qqoA/6pV/6qq/6r//6oAAP9VAP+qAP//AP8AVf9VVf+qVf//Vf8Aqv9Vqv+qqv//qv8A//9V//+q///////UZ2WPAAAAUElEQVQI12NgYGRiZmFlY2fg4OTi5uHl42cQEBQSFhEVE2eQkJSSlpGVk2dQUFRSVlFVU2fQ0NTS1tHV02cwMDQyNjE1M2ewsLSytrG1swcAu/gH4YyumyAAAAAASUVORK5CYII=";
const changed = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAMAAADz0U65AAAAwFBMVEX///+q//9V//8A////qv+qqv9Vqv8Aqv//Vf+qVf9VVf8AVf//AP+qAP9VAP8AAP///6qq/6pV/6oA/6r/qqqqqqpVqqoAqqr/VaqqVapVVaoAVar/AKqqAKpVAKoAAKr//1Wq/1VV/1UA/1X/qlWqqlVVqlUAqlX/VVWqVVVVVVUAVVX/AFWqAFVVAFUAAFX//wCq/wBV/wAA/wD/qgCqqgBVqgAAqgD/VQCqVQBVVQAAVQD/AACqAABVAAAAAABVk+MwAAAAUElEQVQI12NgYGRiZmFlY2fg4OTi5uHl42cQEBQSFhEVE2eQkJSSlpGVk2dQUFRSVlFVU2fQ0NTS1tHV02cwMDQyNjE1M2ewsLSytrG1swcAu/gH4YyumyAAAAAASUVORK5CYII=";

// The same thresholded hald:2 pixels encoded as one-bit gray and PNG24 RGB.
const grayTable = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAFElEQVQI12NgYKhnYGD4D8aMDP8BFXcDfoi7yFgAAAAASUVORK5CYII=";
const rgbTable = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIUlEQVQI12NgwAEYGRgY/v//z0A8YCRNOek6/v//j1MHAN20DvbpW93hAAAAAElFTkSuQmCC";

for (const highDepth of [false, true])
for (const mode of ["map", "command"] as const)
it.each([
  // Undersized and non-cubic tables use the next Hald level, starting at 2.
  { lut: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVQI12NgYGD4zwAl/gMAD/4C/jE7JUUAAAAASUVORK5CYII=", channels: [], expected: [0, 63, 192, 255] },
  { lut: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", channels: [], expected: [63, 0, 192, 255] },
  { lut: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAF0lEQVQI12P8z4AALKsZQrFzGBkYEAoBe+gECZtuXNMAAAAASUVORK5CYII=", channels: [], expected: [0, 0, 255, 255] },
  { lut: "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAJCAIAAABv85FHAAAAIElEQVQI12P8z4ATsDxgUKC63EO8+uSpbR8jAwNOHwIA7+oJHfuwScgAAAAASUVORK5CYII=", channels: [], expected: [0, 0, 255, 255] },
  { lut: grayTable, channels: [], expected: [0, 0, 0, 255] },
  { lut: rgbTable, channels: [], expected: [129, 129, 129, 255] },
  { lut: identity, channels: [], expected: [64, 128, 192, 255] },
  { lut: changed, channels: [], expected: [191, 127, 63, 255] },
  { lut: changed, channels: ["-channel", "R"], expected: [191, 128, 192, 255] },
])(`${mode}, highDepth=${highDepth}: applies a 3D Hald lookup $expected`, async ({ lut, channels, expected }) => {
  const files = new Map([["/base.png", Buffer.from(base, "base64")], ["/lut.png", Buffer.from(lut, "base64")]]);
  if (highDepth) {
    const image = decodeImage(files.get("/base.png")!);
    files.set("/base.png", Buffer.from(encodeImage({ ...image, depth: "ushort", data16: Uint16Array.from(image.data, value => value * 257) }, { format: "png" }).data));
  }
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["/base.png", "/lut.png", ...channels, "-hald-clut", "/out.png"];
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

for (const mode of ["map", "command"] as const)
it.each([
  { alpha: 0, channels: "RGBA", expected: [0, 0, 255, 192, 0, 0, 255, 66] },
  { alpha: 0, channels: "RGB", expected: [0, 0, 255, 64, 0, 0, 255, 128] },
  { alpha: 0, channels: "A", expected: [64, 128, 192, 192, 192, 128, 64, 66] },
  { alpha: 255, channels: "RGBA", expected: [63, 0, 192, 255, 189, 0, 66, 255] },
])(`${mode}: excludes hidden Hald RGB, alpha=$alpha, channels=$channels`, async ({ alpha, channels, expected }) => {
  // Native ImageMagick 7.1.2 RGBA8 results for alternating red/blue cube entries.
  const metadata = { format: "png" as const, space: "srgb" as const, channels: 4 as const, depth: "uchar" as const, density: 72, hasAlpha: true };
  const source = Uint8Array.of(64, 128, 192, 64, 192, 128, 64, 128);
  const lookup = Uint8Array.from({ length: 256 }, (_, index) => [255, 0, 0, alpha, 0, 0, 255, 255][index % 8]!);
  const files = new Map([
    ["/base.png", encodeImage({ ...metadata, width: 2, height: 1, data: source }, { format: "png" }).data],
    ["/lut.png", encodeImage({ ...metadata, width: 8, height: 8, data: lookup }, { format: "png" }).data],
  ]);
  expect(decodeImage(files.get("/lut.png")!).data).toEqual(lookup);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["/base.png", "/lut.png", "-channel", channels, "-hald-clut", "/out.png"];
  let stderr = "";
  const result = mode === "map" ? await runConvertCli(args, files) : await createConvertCommand().execute({
    command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png")).data).toEqual(Uint8Array.from(expected));
});

for (const mode of ["map", "command"] as const)
for (const hasAlpha of [false, true])
for (const lookupAlpha of [false, true])
for (const selection of [[], ["-channel", "RGBA"], ["-channel", "RGB"], ["-channel", "RGB", "+channel"]])
it(`${mode}: Hald alpha source=${hasAlpha}, lookup=${lookupAlpha}, selection=${selection}`, async () => {
  const metadata = { format: "png" as const, space: "srgb" as const, depth: "uchar" as const, density: 72 };
  const source = Uint8Array.of(64, 128, 192, hasAlpha ? 64 : 255, 192, 128, 64, hasAlpha ? 128 : 255);
  const table = decodeImage(Buffer.from(identity, "base64"));
  for (let offset = 3; offset < table.data.length; offset += 4) table.data[offset] = lookupAlpha ? 64 : 255;
  const files = new Map([
    ["/base.png", encodeImage({ ...metadata, width: 2, height: 1, data: source, hasAlpha, channels: hasAlpha ? 4 : 3 }, { format: "png" }).data],
    ["/lut.png", encodeImage({ ...table, hasAlpha: lookupAlpha, channels: lookupAlpha ? 4 : 3 }, { format: "png" }).data],
  ]);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["/base.png", "/lut.png", ...selection, "-hald-clut", "/out.png"];
  expect(await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" }))
    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const expected = source.slice();
  if (selection.length !== 2 || selection[1] !== "RGB") {
    expected[3] = expected[7] = lookupAlpha ? 64 : 255;
  }
  expect(decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png")).data).toEqual(expected);
});
