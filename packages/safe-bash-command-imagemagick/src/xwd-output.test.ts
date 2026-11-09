import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native PNG24 and indexed PNG representations of the same asymmetric 7×3 raster.
const inputs = {
  truecolor: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAIAAADQoYKSAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcMEST3zKVJAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEyOjE3OjM2KzAwOjAwAk/dRAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMjoxNzozNiswMDowMHMSZfgAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTI6MTc6MzYrMDA6MDAkB0QnAAAAJElEQVQI12XIsQ0AIAwDMEfi8HJ52Lrg0SkpNNa5hsE1u6E+DyhSBocR6GCMAAAAAElFTkSuQmCC",
  indexed: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAMAAABoHeX3AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAMUExURf8AAAD/AIAAgAAA//tQDXsAAAAHdElNRQfqCwcMEST3zKVJAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEyOjE3OjM2KzAwOjAwAk/dRAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMjoxNzozNiswMDowMHMSZfgAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTI6MTc6MzYrMDA6MDAkB0QnAAAAF0lEQVQI12NgYGRkAAEmRkYmIGBghgAAASQAJJ4hDhgAAAAASUVORK5CYII="
};
const rgbHash = "bed3a6dc1b82cf207d47ca34c4763d6756229e52f04bf5fb9dd50f8dd5a852a6";

function checkXwd(bytes: Uint8Array): void {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(header.getUint32(4)).toBe(7); // XWD version, not a PNG signature.
  expect(header.getUint32(8)).toBe(2); // ZPixmap.
  expect(header.getUint32(12)).toBe(24);
  expect(header.getUint32(16)).toBe(7);
  expect(header.getUint32(20)).toBe(3);
  expect(header.getUint32(28)).toBe(1); // MSBFirst RGB samples.
  expect(header.getUint32(44)).toBe(24);
  expect(header.getUint32(48)).toBe(24); // Rows are padded to 32 bits.
  expect(header.getUint32(52)).toBe(4); // TrueColor visual.
  expect([56, 60, 64].map(offset => header.getUint32(offset))).toEqual([0xff0000, 0xff00, 0xff]);
  const start = header.getUint32(0) + header.getUint32(76) * 12;
  expect(bytes.length).toBe(start + 3 * 24);
  const rgb = new Uint8Array(63);
  for (let row = 0; row < 3; row++) rgb.set(bytes.subarray(start + row * 24, start + row * 24 + 21), row * 21);
  expect(createHash("sha256").update(rgb).digest("hex")).toBe(rgbHash);
}

for (const [name, base64] of Object.entries(inputs)) {
  for (const retained of [false, true]) {
    for (const output of ["/out.xwd", "XWD:/out.bin"]) {
      for (const write of [false, true]) {
        it(`writes valid XWD (${name}, retained=${retained}, ${output}, write=${write})`, async () => {
          const input = Buffer.from(base64, "base64"), files = new Map<string, Uint8Array>([["/in.png", input]]);
          const filesystem = new MemoryFileSystem();
          await filesystem.writeFile("/in.png", input);
          const result = await runConvertCli(["/in.png", ...(write ? ["-write", output, "/final.png"] : [output])], retained ? { filesystem, cwd: "/" } : files);
          expect(result.exitCode, result.stderr).toBe(0);
          const path = output.startsWith("XWD:") ? output.slice(4) : output;
          checkXwd(retained ? await filesystem.readFile(path) : files.get(path)!);
        });
      }
    }
  }
  it(`writes XWD through the public magick command and preserves PNG output (${name})`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", Buffer.from(base64, "base64"));
    const argumentValues = createCommandArguments(["/in.png", "-write", "/out.xwd", "/out.png"]);
    const result = await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, env: {}, cwd: "/", fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    checkXwd(await fs.readFile("/out.xwd"));
    const png = decodeImage(await fs.readFile("/out.png"));
    expect([png.width, png.height]).toEqual([7, 3]);
    const rgb = png.data.filter((_, index) => index % 4 !== 3);
    expect(createHash("sha256").update(rgb).digest("hex")).toBe(rgbHash);
  });
}
