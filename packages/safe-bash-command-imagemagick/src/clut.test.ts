import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
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

for (const mode of ["map", "command"] as const)
for (const lookup of [[255, 0, 0, 255, 0, 0], [255, 0, 0, 0, 0, 255]])
it(`${mode}: preserves color added by CLUT to a grayscale PNG (${lookup})`, async () => {
  // Native ImageMagick 7.1.2: 4x4 gray(50%), depth 8, PNG color type 0.
  const base = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAAEElEQVQI12NsYGBgYGJAIQAJ5ACImX8gxQAAAABJRU5ErkJggg==", "base64");
  expect(base[25]).toBe(0);
  const files = new Map<string, Uint8Array>([["/base.png", base], ["/lut.png", await sharp(Uint8Array.from(lookup), {
    raw: { width: 2, height: 1, channels: 3 },
  }).png().toBuffer()]]);
  const fs = new MemoryFileSystem();
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
  const bytes = mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png");
  const expected = lookup[3] === 255 ? [255, 0, 0, 255] : [127, 0, 128, 255];
  expect(decodeImage(bytes).data).toEqual(Uint8Array.from({ length: 64 }, (_, index) => expected[index % 4]!));
  expect([2, 3, 6]).toContain(bytes[25]);
});

for (const mode of ["map", "command"] as const)
for (const vertical of [false, true])
it.each([
  { source: [64, 128, 192, 128], alpha: 0, channels: [], expected: [0, 0, 255, 128] },
  { source: [64, 128, 192, 255], alpha: 0, channels: [], expected: [0, 0, 255, 255] },
  { source: [64, 128, 192, 128], alpha: 128, channels: ["-channel", "RGBA"], expected: [153, 0, 219, 192] },
  { source: [64, 128, 192, 128], alpha: 0, channels: ["-channel", "R"], expected: [0, 128, 192, 128] },
  { source: [64, 128, 192, 128], alpha: 255, channels: ["-channel", "R"], expected: [191, 128, 192, 128] },
  { source: [0, 0, 0, 128], alpha: 0, channels: [], expected: [0, 0, 0, 128] },
])(`${mode}: alpha-weights CLUT colors, vertical=${vertical}, $source/$alpha/$channels`, async ({ source, alpha, channels, expected }) => {
  // RGBA8 results verified with native ImageMagick 7.1.2.
  const files = new Map<string, Uint8Array>([
    ["/base.png", await sharp(Uint8Array.from(source), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer()],
    ["/lut.png", await sharp(Uint8Array.of(255, 0, 0, alpha, 0, 0, 255, 255), {
      raw: { width: vertical ? 1 : 2, height: vertical ? 2 : 1, channels: 4 },
    }).png().toBuffer()],
  ]);
  expect(decodeImage(files.get("/lut.png")!).data).toEqual(Uint8Array.of(255, 0, 0, alpha, 0, 0, 255, 255));
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["/base.png", "/lut.png", ...channels, "-clut", "/out.png"];
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

for (const retained of [false, true])
it.each([
  { channels: 4, selection: [], expected: [191, 0, 192, 64] },
  { channels: 3, selection: [], expected: [191, 0, 192, 255] },
  { channels: 4, selection: ["-channel", "RGB"], expected: [191, 0, 192, 128] },
  { channels: 4, selection: ["-channel", "A"], expected: [64, 128, 192, 64] },
] as const)(`maps CLUT alpha only for active channels, retained=${retained}: $channels/$selection`, async ({ channels, selection, expected }) => {
  const files = new Map<string, Uint8Array>([
    ["/base.png", await sharp(Uint8Array.from([64, 128, 192, 128].slice(0, channels)), {
      raw: { width: 1, height: 1, channels },
    }).png().toBuffer()],
    ["/lut.png", await sharp(Uint8Array.of(255, 0, 0, 64, 0, 0, 255, 64), {
      raw: { width: 2, height: 1, channels: 4 },
    }).png().toBuffer()],
  ]);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  expect(await runConvertCli(["/base.png", "/lut.png", ...selection, "-clut", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toEqual(Uint8Array.from(expected));
});

for (const retained of [false, true])
for (const highDepth of [false, true])
it(`samples both CLUT dimensions, retained=${retained}, highDepth=${highDepth}`, async () => {
  const metadata = { format: "png" as const, space: "srgb" as const, channels: 4 as const, density: 72, hasAlpha: true };
  const source = Uint8Array.of(0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255);
  const base = encodeImage({ ...metadata, width: 3, height: 1, depth: highDepth ? "ushort" : "uchar", data: source,
    ...(highDepth ? { data16: Uint16Array.from(source, value => value * 257) } : {}) }, { format: "png" }).data;
  const lut = encodeImage({ ...metadata, width: 2, height: 2, depth: "uchar",
    data: Uint8Array.of(0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255) }, { format: "png" }).data;
  const files = new Map([["/base.png", base], ["/lut.png", lut]]), fs = new MemoryFileSystem();
  for (const [path, data] of files) await fs.writeFile(path, data);
  expect(await runConvertCli(["/base.png", "/lut.png", "-clut", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
  // Native ImageMagick: black, neutral midpoint (404040), blue.
  if (!highDepth) expect(output.data).toEqual(Uint8Array.of(0, 0, 0, 255, 64, 64, 64, 255, 0, 0, 255, 255));
  if (highDepth) expect(output.data16).toEqual(Uint16Array.of(0, 0, 0, 65535, 16383, 16383, 16513, 65535, 0, 0, 65535, 65535));
});
