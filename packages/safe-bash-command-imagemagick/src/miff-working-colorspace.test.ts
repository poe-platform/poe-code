import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pam = Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from("0a1e46000a2846806e5082ff", "hex")]);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAACVBMVEX///8KKEZuUIJrQLBtAAAAAXRSTlMAQObYZgAAAAxJREFUCNdjYGBkAgAACAAE58Ov+QAAAABJRU5ErkJggg==", "base64");
const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
// Raster bytes from native ImageMagick Q16-HDRI, including alpha.
const cases = [
    ["pam", "sRGB", "sRGB", "0a1e46000a2846806e5082ff"],
    ["pam", "Lab", "CIELab", "1f89640028816a80639668ff"],
    ["pam", "XYZ", "XYZ", "04040f0005051080221b39ff"],
    ["pam", "YUV", "YUV", "1d946f0022916a805f918dff"],
    ["png", "XYZ", "XYZ", "f2ffff00050510ff221b39ff"],
    ["png", "YUV", "YUV", "ff80800022916aff5f918dff"]
] as const;

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`writes %s working %s samples and tag (${mode})`, async (format, space, tag, raster) => {
        const input = format === "pam" ? pam : png;
        const path = `/in.${format}`, files = new Map<string, Uint8Array>([[path, input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile(path, input);
        const operations = ["-colorspace", space, ...(format === "png" ? ["-unique-colors"] : []), "-depth", "8"];
        const args = [path, ...operations, "/out.miff"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!;
        const end = output.indexOf(26) + 1;
        expect.soft(new TextDecoder().decode(output.subarray(0, end))).toContain(`colorspace=${tag}\n`);
        expect(Buffer.from(output.subarray(end)).toString("hex")).toBe(raster);
        if (nativeMagick) {
            const reference = spawnSync("magick", [`${format}:-`, ...operations, "miff:-"], { input });
            expect(reference.status).toBe(0);
            for (const bytes of [reference.stdout, output]) {
                const metadata = spawnSync("magick", ["miff:-", "-format", "%[colorspace]", "info:"], { input: bytes });
                expect(metadata.status).toBe(0);
                expect(metadata.stdout.toString()).toBe(tag);
                const pixels = spawnSync("magick", ["miff:-", "-channel", "red", "-separate", "-depth", "8", "gray:-"], { input: bytes });
                expect(pixels.status).toBe(0);
                expect(pixels.stdout).toEqual(Buffer.from(raster, "hex").filter((_, index) => index % 4 === 0));
            }
        }
    });
}
