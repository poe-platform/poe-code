import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { compositeImage, decodeImage, encodeImage } from "./portable.js";

describe("portable image engine", () => {
  it("roundtrips HEIF pixels with the portable compression codec", () => {
    const image = decodeImage(undefined, { create: { width: 1, height: 1, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } } });
    const decoded = decodeImage(encodeImage(image, { format: "heif" }).data);
    expect(decoded.data).toEqual(image.data);
  });

  it("requires an injected filesystem for composite paths", () => {
    const image = decodeImage(undefined, { create: { width: 1, height: 1, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } } });
    const fs = createFsFromVolume(Volume.fromJSON({ "/overlay.png": Buffer.from(encodeImage(image, { format: "png" }).data) }));
    expect(() => compositeImage(image, [{ input: "/overlay.png" }])).toThrow("explicit readFile capability");
    expect(compositeImage(image, [{ input: "/overlay.png" }], path => new Uint8Array(fs.readFileSync(path) as Buffer)).data).toEqual(image.data);
  });
  it("bundles for Workers without Node builtins", async () => {
    const result = await build({
      entryPoints: [new URL("./portable.ts", import.meta.url).pathname],
      bundle: true, platform: "browser", format: "esm", write: false,
      metafile: true, logLevel: "silent"
    });
    expect(Object.keys(result.metafile!.inputs).some(name => name.endsWith("sharp.ts"))).toBe(false);
    expect(result.outputFiles[0]!.text).not.toContain('"node:');
  });
});
