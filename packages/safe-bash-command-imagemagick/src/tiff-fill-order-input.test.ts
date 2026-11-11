import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./tiff-fill-order-fixtures.json";

// Native ImageMagick 7.1.2-35 Q16-HDRI, independent of our TIFF writer:
// P6\n3 2\n255\n + RGB 123456234567345678abcdef98badc765432
// magick in.ppm -compress METHOD -define tiff:rows-per-strip=1 -define tiff:fill-order=ORDER out.tif
// Expected RGB: magick out.tif -depth 8 rgb:- (JPEG is lossy).
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(fixtures)(`${mode}: decodes native $compression TIFF with $order FillOrder`, async ({ input, rgb }) => {
        const bytes = Uint8Array.from(Buffer.from(input, "base64"));
        const original = bytes.slice();
        const files = new Map([["/in.tif", bytes]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", bytes);
        const args = ["/in.tif", "-depth", "8", "rgb:/out.rgb"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "retained" || mode === "command"
            ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb")!;
        expect(Buffer.from(output).toString("hex")).toBe(rgb);
        expect(bytes).toEqual(original);
        expect(await filesystem.readFile("/in.tif")).toEqual(original);
    });
}
