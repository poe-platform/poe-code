import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "retained", "streamed"] as const) {
    it.each([[1, "3e+02"], [2, "2.6e+02"], [3, "255"]] as const)(`formats histogram tuples with precision %s (${mode})`, async (precision, sample) => {
        const source = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 0 0 255\n");
        const files = new Map([["in.ppm", source]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", source);
        let streamed = "";
        const input = { filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(bytes: Uint8Array) { streamed += new TextDecoder().decode(bytes); } } } : {}) };
        const expected = `             1: (0,0,${sample}) #0000FF blue\n             2: (${sample},0,0) #FF0000 red\n`;
        for (const format of ["%c", "%[comment]"]) {
            const args = ["in.ppm", "-precision", String(precision), "-format", format, "histogram:info:"];
            streamed = "";
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
            expect(result).toEqual({ exitCode: 0, stdout: mode === "streamed" ? "" : expected, stderr: "" });
            if (mode === "streamed") expect(streamed).toBe(expected);
        }
    });
}
