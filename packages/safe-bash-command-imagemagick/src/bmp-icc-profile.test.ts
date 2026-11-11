import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const tagged = readFileSync(new URL("./fixtures/append-icc-tagged.png", import.meta.url));
const profile = spawnSync("magick", ["png:-", "icc:-"], { input: tagged }).stdout;
// The input must come from an independent writer.
const native = spawnSync("magick", ["png:-", "-type", "TrueColor", "-compress", "none", "bmp:-"], { input: tagged });
const input = new Uint8Array(native.stdout);

it("reads the embedded V5 profile as BMP metadata", () => {
  expect(native.status, native.stderr.toString()).toBe(0);
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
      const recovered = spawnSync("magick", ["png:-", "icc:-"], { input: output });
      expect(recovered.status).toBe(0);
      expect(recovered.stdout).toEqual(profile);
    }
    const pixels = spawnSync("magick", ["png:-", "-depth", "8", "rgba:-"], { input: output });
    const expected = spawnSync("magick", ["bmp:-", "-depth", "8", "rgba:-"], { input });
    expect(pixels.status).toBe(0);
    expect(expected.status).toBe(0);
    expect(pixels.stdout).toEqual(expected.stdout);
  });
}
