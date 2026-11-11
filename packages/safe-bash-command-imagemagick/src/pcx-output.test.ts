import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const input = Buffer.from("50360a3320320a3235350aff000000ff000000ffffee00991177245384", "hex");

function checkPcx(bytes: Uint8Array): void {
  // Native ImageMagick's header for this PPM and 36x72 DPI.
  expect(Buffer.from(bytes.subarray(0, 16)).toString("hex")).toBe("0a050108000000000200010024004800");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes[65]).toBe(3);
  const stride = header.getUint16(66, true);
  expect(stride).toBeGreaterThanOrEqual(3);
  const samples: number[] = [];
  for (let offset = 128; offset < bytes.length;) {
    const value = bytes[offset++]!;
    if (value >= 192) samples.push(...Array<number>(value & 63).fill(bytes[offset++]!));
    else samples.push(value);
  }
  expect(samples).toHaveLength(stride * 3 * 2);
  const pixels: number[] = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
    for (let channel = 0; channel < 3; channel++) pixels.push(samples[(y * 3 + channel) * stride + x]!);
  }
  expect(pixels).toEqual([...input.subarray(11)]);
}

for (const retained of [false, true]) {
  for (const output of ["/out.pcx", "PCX:/out.bin"]) {
    for (const write of [false, true]) {
      it(`writes real PCX from PPM (${output}, retained=${retained}, write=${write})`, async () => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = await runConvertCli(["/in.ppm", "-units", "PixelsPerInch", "-density", "36x72", ...(write ? ["-write", output, "/out.tif"] : [output])], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const path = output.startsWith("PCX:") ? output.slice(4) : output;
        checkPcx(retained ? await filesystem.readFile(path) : files.get(path)!);
        if (write) {
          const tiff = decodeImage(retained ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!);
          expect(tiff.format).toBe("tiff");
          expect(tiff.data).toEqual(decodeImage(input).data);
        }
      });
    }
  }
}

it("writes PCX through the public magick command", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
  const argumentValues = createCommandArguments(["/in.ppm", "-units", "PixelsPerInch", "-density", "36x72", "/out.pcx"]);
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, env: {}, cwd: "/", fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  checkPcx(await fs.readFile("/out.pcx"));
});
