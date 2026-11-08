import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2: magick -size 1x1 xc:#80402080 [-fuzz FUZZ]
// -transparent TARGET -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operator of ["-transparent", "+transparent"]) {
        it.each([
            ["#804020", undefined, 128],
            ["#80402080", undefined, 0],
            ["#81402080", undefined, 128],
            ["#804020", "49%", 128],
            ["#804020", "50%", 0],
            ["#80402090", "6%", 128],
            ["#80402090", "7%", 0],
            ["#a0402080", "3%", 128],
            ["#a0402080", "4%", 0],
            ["#a0402090", "7%", 128],
            ["#a0402090", "8%", 0],
            ["#80402090", "4000", 128],
            ["#80402090", "4200", 0],
        ] as const)(`${mode}: ${operator} %s with fuzz %s`, async (target, fuzz, alpha) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:#80402080", ...(fuzz === undefined ? [] : ["-fuzz", fuzz]), operator, target, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([128, 64, 32, operator === "-transparent" ? alpha : 128 - alpha]);
        });
    }
}
