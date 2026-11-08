import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { operations: ["-evaluate", "add", "100%", "-evaluate", "subtract", "50%"], expected: [160, 224, 255, 255, 192, 144, 208, 240, 255] },
    { operations: ["-evaluate", "subtract", "100%", "-evaluate", "add", "100%"], expected: [32, 96, 160, 192, 64, 16, 80, 112, 176] },
    { operations: ["-evaluate", "multiply", "4", "-evaluate", "divide", "4"], expected: [32, 96, 160, 192, 64, 16, 80, 112, 176] },
    { operations: ["-evaluate", "add", "100%"], expected: Array(9).fill(255) },
    { operations: ["-evaluate", "add", "100%", "-clamp", "-evaluate", "subtract", "50%"], expected: Array(9).fill(127) },
    { operations: ["-clamp", "-evaluate", "add", "100%", "-evaluate", "subtract", "100%"], expected: [32, 96, 160, 192, 64, 16, 80, 112, 176] },
    { operations: ["-evaluate", "add", "100%", "-clamp", "-evaluate", "subtract", "100%"], expected: Array(9).fill(0) },
    { operations: ["-evaluate", "subtract", "100%", "-clamp", "-evaluate", "add", "100%"], expected: Array(9).fill(255) },
    { operations: ["-evaluate", "add", "100%", "-channel", "R", "-clamp", "+channel", "-evaluate", "subtract", "100%"], expected: [0, 96, 160, 0, 64, 16, 0, 112, 176] },
    { operations: ["-channel", "R", "-evaluate", "add", "100%", "-evaluate", "subtract", "100%"], expected: [32, 96, 160, 192, 64, 16, 80, 112, 176] },
  ])(`${mode}: preserves evaluate range through $operations`, async ({ operations, expected }) => {
    const bytes = await sharp(new Uint8Array([32, 96, 160, 192, 64, 16, 80, 112, 176]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const args = ["/in.png", ...operations, "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data].filter((_, index) => index % 4 !== 3)).toEqual(expected);
  });
}

it("preserves alpha and samples across retained storage chunks", async () => {
  const pixels = Uint8Array.from({ length: 4100 * 4 }, (_, index) => index % 251);
  const bytes = await sharp(pixels, { raw: { width: 4100, height: 1, channels: 4 } }).png().toBuffer();
  const filesystem = createMemoryFileSystem();
  await filesystem.writeFile("/in.png", bytes);
  const result = await runConvertCli(["/in.png", "-evaluate", "subtract", "100%", "-evaluate", "add", "100%", "/out.png"], { filesystem, cwd: "/" });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(decodeImage(await filesystem.readFile("/out.png")).data).toEqual(pixels);
});

for (const retained of [false, true]) {
  it(`retains Q16 precision across overflow (retained=${retained})`, async () => {
    const data16 = Uint16Array.from([0x1234, 0x5678, 0x9abc, 0xdef0]);
    const bytes = encodeImage({ width: 1, height: 1, format: "png", density: 72, channels: 4, hasAlpha: true, space: "srgb", depth: "ushort",
      data16, data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const result = await runConvertCli(["/in.png", "-evaluate", "add", "100%", "-evaluate", "subtract", "100%", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data16).toEqual(data16);
  });
}
