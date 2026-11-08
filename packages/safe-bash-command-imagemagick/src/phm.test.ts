import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick PHM output for the 8x2 RGB grid, including bottom-first rows.
const input = Buffer.from("50480a3820320a312e300a38442004390538cd30243a7e395534043bf839de35f631a63a6637e835c63aef38ed385c3b7739e639d63c003adf3b4f0000290531052c44312535753044348538343266367639ae344438343b273555392d2cc536663a26342437773b1f3717", "hex");
const expected = Array.from({ length: 16 }, (_, i) => [i * 17 % 256, (10 + i * 31) % 256, (40 + i * 47) % 256, 255]).flat();

it("reads PHM metadata and decodes half floats in display row order", () => {
    expect(readImageMetadata(input)).toMatchObject({ format: "phm", width: 8, height: 2, channels: 3, bitsPerSample: 16, depth: "float" });
    expect(Array.from(decodeImage(input).data)).toEqual(expected);
});

for (const sync of [false, true]) it(`converts native PHM to PNG, sync=${sync}`, async () => {
    const files = new Map<string, Uint8Array>([["in.phm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.phm", input);
    const args = ["in.phm", "out.png"];
    const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = sync ? files.get("out.png")! : await filesystem.readFile("/out.png");
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([8, 2]);
    expect(Array.from(image.data)).toEqual(expected);
});

it("rejects truncated PHM samples before decoding", () => {
    expect(() => decodeImage(input.subarray(0, -1))).toThrow("Truncated PHM raster");
});
