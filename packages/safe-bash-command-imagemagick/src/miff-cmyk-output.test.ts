import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeMiffImage } from "../../image-ast/src/codecs/miff-input.js";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const intermediate of [false, true]) {
        it.each(["None", "RLE", "Zip", "BZip"])(`preserves CMYK black and alpha in ${mode} MIFF output (write=${intermediate}, %s)`, async compression => {
            const input = Buffer.concat([
                Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
                Buffer.from("0a1e46000a2846806e5082ff", "hex"),
            ]);
            const files = new Map([["/in.pam", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pam", input);
            const argv = ["/in.pam", "-colorspace", "CMYK", "-depth", "8", "-compress", compression,
                ...(intermediate ? ["-write", "/out.miff", "null:"] : ["/out.miff"])];
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!;
            const decoded = decodeMiffImage(output);
            expect(decoded).toMatchObject({ space: "cmyk", channels: 5, hasAlpha: true });
            // ImageMagick 7.1.2-35 Q16-HDRI reference: inspect inks, since RGBA hides black loss.
            expect(Buffer.from(Uint8Array.from(decoded.hueSamples!, value => Math.round(value * 255))).toString("hex")).toBe("db9200b9db6d00b92762007d");
            expect([3, 7, 11].map(index => decoded.data[index])).toEqual([0, 128, 255]);
        });
    }
}
