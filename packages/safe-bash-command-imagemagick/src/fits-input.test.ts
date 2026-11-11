import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function fits(overrides: string[] = [], pixels = [0, 64, 255, 128, 32, 16]) {
  const cards = ["SIMPLE  =                    T", "BITPIX  =                    8", "NAXIS   =                    2", "NAXIS1  =                    3", "NAXIS2  =                    2", ...overrides, "END"];
  const bytes = new Uint8Array(5760);
  bytes.set(new TextEncoder().encode(cards.map(card => card.padEnd(80)).join("").padEnd(2880)));
  bytes.set(pixels, 2880);
  return bytes;
}

it.each(["buffered", "retained", "sync"] as const)("decodes unsigned FITS primary rows through %s convert", async mode => {
  const bytes = fits(), files = new Map([["known.fits", bytes]]), filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/known.fits", bytes);
  const args = ["known.fits", "-depth", "8", "gray:plane.raw"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const output = mode === "retained" ? await filesystem.readFile("/plane.raw") : files.get("plane.raw");
  expect(output).toEqual(new Uint8Array([128, 32, 16, 0, 64, 255]));
});

it.each([
  ["truncated pixels", fits().slice(0, 2885)],
  ["unsupported depth", fits(["BITPIX  =                   16"])],
  ["invalid dimensions", fits(["NAXIS1  =                   -3"])],
  ["unsupported scaling", fits(["BSCALE  =                    2"])],
] as const)("rejects %s without replacing output", async (_name, bytes) => {
  const existing = new Uint8Array([42]), files = new Map([["known.fits", bytes], ["out.png", existing]]);
  expect((await runConvertCli(["known.fits", "out.png"], files)).exitCode).toBe(1);
  expect(files.get("out.png")).toEqual(existing);
});

it("reads padded multi-block FITS metadata and enforces pixel limits", async () => {
  const { decodeImage, readImageMetadata, readImageMetadataFromSource } = await import("@poe-code/image-ast/portable");
  const bytes = new Uint8Array(8640);
  const cards = ["SIMPLE  =                    T", "BITPIX  =                    8 / unsigned bytes", "NAXIS   =                    2", "NAXIS1  =                    3", "NAXIS2  =                    2", ...Array<string>(32).fill("COMMENT padding"), "END"];
  bytes.set(new TextEncoder().encode(cards.map(card => card.padEnd(80)).join("").padEnd(5760)));
  bytes.set([0, 64, 255, 128, 32, 16], 5760);
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  const metadata = readImageMetadata(bytes);
  expect(metadata).toMatchObject({ format: "fits", width: 3, height: 2, channels: 1, hasAlpha: false });
  expect(await readImageMetadataFromSource(source, new AbortController().signal)).toEqual(metadata);
  expect(Array.from(decodeImage(bytes).data).filter((_, index) => index % 4 === 0)).toEqual([128, 32, 16, 0, 64, 255]);
  expect(() => decodeImage(bytes, { limitInputPixels: 5 })).toThrow("pixel limit");
});
