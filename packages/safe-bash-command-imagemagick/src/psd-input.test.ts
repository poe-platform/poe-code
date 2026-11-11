import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7: magick in.ppm -units PixelsPerInch -density 36x72 in.psd
// PPM raster: ff000000ff000000ffffee00991177245384 (3 by 2).
const fixture = Buffer.from("OEJQUwABAAAAAAAAAAMAAAACAAAAAwAIAAMAAAAAAAAAHDhCSU0D7QAAAAAAEAAkAAEAAQABAEgAAQABAAEAAABiAAAAWgABAAAAAAAAAAAAAAACAAAAAwADAAAAAAAIAAEAAAAIAAIAAAAIOEJJTW5vcm3/AAEAAAAADAAAAAAAAAAAAkwxAAAA/wAA/5kkAAAA/wDuEVMAAAAA/wB3hAAAAAAAAP8AAP+ZJAD/AO4RUwAA/wB3hA==", "base64");
const pixels = "ff000000ff000000ffffee00991177245384";
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["[0]", "[1]", "", "[1,0]"])(`reads native PSD composite and layers (${mode}, %s)`, async selector => {
        const files = new Map([["/in.psd", fixture]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.psd", fixture);
        const args = [`/in.psd${selector}`, "-depth", "8", "rgb:/out.raw"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels.repeat(selector === "" || selector === "[1,0]" ? 2 : 1));
    });
}
