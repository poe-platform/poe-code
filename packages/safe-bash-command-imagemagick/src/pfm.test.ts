import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const sync of [false, true]) for (const destination of ["out.pfm", "PFM:out.bin", "pfm:-"]) for (const write of [false, true]) {
    it(`writes float32 PFM samples to ${destination}, sync=${sync}, write=${write}`, async () => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => {
            const pixel = Math.floor(i / 3);
            return i % 3 === 0 ? pixel * 17 % 256 : i % 3 === 1 ? (10 + pixel * 31) % 256 : (40 + pixel * 47) % 256;
        });
        // Native ImageMagick PNG24 fixture for the RGB grid above.
        const input = Buffer.from("89504e470d0a1a0a0000000d4948445200000008000000020802000000eaf60aba0000001b4944415408d76364e0d21094d7c7442c1d3f2a047fe82321281700f30f0d9a8f67c0c40000000049454e44ae426082", "hex");
        const files = new Map<string, Uint8Array>([["input", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input", input);
        const args = ["input", ...(write ? ["-write", destination, "null:"] : [destination])];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const path = destination === "out.pfm" ? "out.pfm" : "out.bin";
        const output = Buffer.from((destination === "pfm:-" ? result.stdoutBytes : sync ? files.get(path) : await filesystem.readFile("/" + path))!);
        expect(output.subarray(0, 11).toString()).toBe("PF\n8 2\n1.0\n");
        expect(output.length).toBe(203);
        for (let y = 0; y < 2; y++) for (let x = 0; x < 24; x++) {
            expect(output.readFloatBE(11 + (y * 24 + x) * 4)).toBe(Math.fround(pixels[(1 - y) * 24 + x]! / 255));
        }
    });
}

for (const sync of [false, true]) it(`preserves 16-bit grayscale precision in PFM, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from("P5\n1 2\n65535\n"), Buffer.from([0, 1, 128, 1])]);
    const files = new Map<string, Uint8Array>([["input", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input", input);
    const args = ["input", "pfm:-"];
    const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdoutBytes!);
    expect(output.subarray(0, 11).toString()).toBe("Pf\n1 2\n1.0\n");
    expect(output.length).toBe(19);
    expect(output.readFloatBE(11)).toBe(Math.fround(32769 / 65535));
    expect(output.readFloatBE(15)).toBe(Math.fround(1 / 65535));
});
