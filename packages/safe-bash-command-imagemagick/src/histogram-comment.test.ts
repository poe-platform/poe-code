import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const expected =
    "             1: (0,0,0) #000000 black\n" +
    "             1: (0,0,255) #0000FF blue\n" +
    "             2: (0,255,0) #00FF00 lime\n" +
    "             4: (255,0,0) #FF0000 red\n";

for (const retained of [false, true]) {
    for (const format of ["miff", "png"]) {
        it.each([false, true])(`saves source color counts in ${format} histogram comments (retained=${retained}, existing comment=%s)`, async existingComment => {
            const pixels = Uint8Array.from([
                255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0,
                0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0
            ]);
            const source = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), pixels]);
            const files = new Map<string, Uint8Array>([["in.ppm", source]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", source);
            const input = retained ? { filesystem, cwd: "/" } : files;
            const args = ["in.ppm", ...(existingComment ? ["-set", "comment", "original"] : [])];
            expect(await runConvertCli([...args, "-format", "%c", "histogram:info:"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
            expect(await runConvertCli([...args, `histogram:out.${format}`], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            expect(await runConvertCli([`out.${format}`, "-format", "%c", "info:"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        });
    }
}
