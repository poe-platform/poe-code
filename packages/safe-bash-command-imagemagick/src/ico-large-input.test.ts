import { expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: magick -size <width>x<height> xc:red input.ico
// Complete native ICO files, deflated for compactness; expected text comes from
// magick input.ico -format '%wx%h:%[pixel:p{0,0}]' info:
const fixtures = [
  {
    "width": 256,
    "height": 16,
    "expected": "256x16:srgba(255,0,0,1)",
    "deflated": "eJztyKEVgDAQRMFNByh0ZMrg0X9PyQEWj2D+vTmxSavLlvo940z2JKNcc8+z3x15aU4AAAAAAAAAAAAAAAAAAADga/pzCwjT4y8="
  },
  {
    "width": 257,
    "height": 16,
    "expected": "257x16:srgba(255,0,0,1)",
    "deflated": "eJztyLENgDAQBMFzB0TEhJRhuVq6NG+REpEhzb7mg0vaui31j1wj2ZOcpbXU8uyr3vPSnAAAAAAAAAAAAAAAAAAAAMDfSd+7AdTAA+A="
  },
  {
    "width": 300,
    "height": 16,
    "expected": "300x16:srgba(255,0,0,1)",
    "deflated": "eJztyKERgDAQRNFNByg0EpFOMvRJl+EGLBrM+zfvxCatri+pv+U8kjXJXnpLLc9+N/LSnAAAAAAAAAAAAAAAAAAAAAAAAPAd6b8uTnhe9w=="
  },
  {
    "width": 16,
    "height": 257,
    "expected": "16x257:srgba(255,0,0,1)",
    "deflated": "eJztyKERgDAQRNENFUShkZQRQTn0b8MxWBpgeP/mrbik1fWW2i3nkaxJ9tLLsjz/uzHy0pwAAAAAAAAAAAAAAAAAAADA10n6cxdsEAOY"
  }
];

it.each(["sync", "buffered", "retained"] as const)("reads native ICO bitmap dimensions beyond directory bytes (%s)", async mode => {
    for (const fixture of fixtures) for (const output of ["info:", "out.png"]) {
        const bytes = new Uint8Array(inflateSync(Buffer.from(fixture.deflated, "base64")));
        const files = new Map([["input.ico", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.ico", bytes);
        const args = ["input.ico", "-format", "%wx%h:%[pixel:p{0,0}]", output];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result, `${fixture.width}x${fixture.height} ${output}`).toMatchObject({ exitCode: 0, stderr: "", stdout: output === "info:" ? fixture.expected : "" });
        if (output === "out.png") {
            const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect(image).toMatchObject({ width: fixture.width, height: fixture.height });
            expect(image.data).toEqual(Uint8Array.from({ length: fixture.width * fixture.height * 4 }, (_, index) => index % 4 === 0 || index % 4 === 3 ? 255 : 0));
        }
    }
});
