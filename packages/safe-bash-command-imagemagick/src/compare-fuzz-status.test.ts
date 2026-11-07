import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI results for these exact RGBA inputs.
for (const metric of [undefined, "RMSE", "PAE", "PSNR", "AE"]) {
    for (const fuzz of ["1%", "50%", "100%"]) {
        for (const mode of ["sync", "async", "retained"]) {
            it(`keeps ${metric ?? "default"} status independent of fuzz coloring: ${fuzz}, ${mode}`, async () => {
                const images = await Promise.all(["102030ff8090a0ff", "102030ff8090f0ff"].map(hex =>
                    sharp(Buffer.from(hex, "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
                const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
                const filesystem = new MemoryFileSystem();
                for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
                const args = [...(metric ? ["-metric", metric] : []), "-fuzz", fuzz,
                    "-compose", "Src", "-highlight-color", "red", "-lowlight-color", "white", "a.png", "b.png", "diff.png"];
                const result = mode === "sync" ? runCompareCliSync(args, files)
                    : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                const tolerated = fuzz !== "1%";
                expect(result).toMatchObject({
                    exitCode: metric === "AE" && tolerated ? 0 : 1,
                    stdout: "",
                    stderr: `${metric === "AE" ? (tolerated ? "0 (0)" : "0.0784314 (0.0392157)")
                        : metric === "PAE" ? "20560 (0.313725)"
                        : metric === "PSNR" ? "19.0999 (0.159166)" : "7269.06 (0.110919)"}\n`
                });
                const diff = mode === "retained" ? await filesystem.readFile("/diff.png") : files.get("diff.png")!;
                const pixels = await sharp(diff).ensureAlpha().raw().toBuffer();
                expect([...pixels]).toEqual([255, 255, 255, 255, 255, tolerated ? 255 : 0, tolerated ? 255 : 0, 255]);
            });
        }
    }
}
