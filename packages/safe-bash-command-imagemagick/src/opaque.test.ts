import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Pixel expectations verified against ImageMagick 7.1.2.
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operator of ["-opaque", "+opaque"]) {
        it.each([
            ["#804020", undefined, false],
            ["#80402080", undefined, true],
            ["#81402080", undefined, false],
            ["#804020", "49%", false],
            ["#804020", "50%", true],
            ["#90402080", "1%", false],
            ["#90402080", "2%", true],
            ["#90402088", "3%", false],
            ["#90402088", "4%", true],
            ["#80402090", "4000", false],
            ["#80402090", "4200", true],
        ] as const)(`${mode}: ${operator} %s with fuzz %s`, async (target, fuzz, matched) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:#80402080", ...(fuzz === undefined ? [] : ["-fuzz", fuzz]), "-fill", "blue", operator, target, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual((operator === "-opaque" ? matched : !matched) ? [0, 0, 255, 255] : [128, 64, 32, 128]);
        });
    }
}
