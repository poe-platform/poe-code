import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operation of ["-border", "-frame"]) {
        it.each(["8", "16"])(`${operation} treats disabled alpha as opaque (${mode}, depth %s)`, async depth => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:#ff000000", "-alpha", "off", "-bordercolor", "blue", "-mattecolor", "blue",
                operation, "1", "-depth", depth, "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            const expected = Array.from({ length: 9 }, (_, pixel) => pixel === 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat();
            expect(Array.from(output)).toEqual(depth === "16" ? expected.flatMap(sample => [sample, sample]) : expected);
        });
    }
}
