import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const magick = process.env.IMAGEMAGICK_TEST_BINARY ?? "magick";
const tagged = readFileSync(new URL("./fixtures/append-icc-tagged.png", import.meta.url));
const profile = execFileSync(magick, ["png:-", "icc:-"], { input: tagged });
// The input must come from an independent writer.
const native = execFileSync(magick, ["png:-", "-type", "TrueColor", "-compress", "none", "bmp:-"], { input: tagged });
const input = new Uint8Array(native);

it("reads the embedded V5 profile as BMP metadata", () => {
  expect(profile.length).toBeGreaterThan(128);
  expect(readImageMetadata(input).icc).toEqual(new Uint8Array(profile));
});

for (const mode of ["sync", "buffered", "retained"] as const) for (const strip of [false, true]) {
  it(`preserves BMP V5 profile bytes and pixels (${mode}, strip=${strip})`, async () => {
    const files = new Map([["/in.bmp", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.bmp", input);
    const args = ["/in.bmp", ...(strip ? ["-strip"] : []), "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(readImageMetadata(output).icc).toEqual(strip ? undefined : new Uint8Array(profile));
    if (!strip) {
      const recovered = execFileSync(magick, ["png:-", "icc:-"], { input: output });
      expect(recovered).toEqual(profile);
    }
    const pixels = execFileSync(magick, ["png:-", "-depth", "8", "rgba:-"], { input: output });
    const expected = execFileSync(magick, ["bmp:-", "-depth", "8", "rgba:-"], { input });
    expect(pixels).toEqual(expected);
  });
}
