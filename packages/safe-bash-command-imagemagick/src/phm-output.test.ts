import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const sync of [false, true]) for (const destination of ["out.phm", "PHM:out.bin", "phm:-"]) for (const write of [false, true]) {
    it(`writes binary16 PHM samples to ${destination}, sync=${sync}, write=${write}`, async () => {
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
        const path = destination === "out.phm" ? "out.phm" : "out.bin";
        const output = Buffer.from((destination === "phm:-" ? result.stdoutBytes : sync ? files.get(path) : await filesystem.readFile("/" + path))!);
        expect(output.subarray(0, 11).toString()).toBe("PH\n8 2\n1.0\n");
        expect(output.length).toBe(107);
        expect(output.toString("hex")).toBe("50480a3820320a312e300a38442004390538cd30243a7e395534043bf839de35f631a63a6637e835c63aef38ed385c3b7739e639d63c003adf3b4f0000290531052c44312535753044348538343266367639ae344438343b273555392d2cc536663a26342437773b1f3717");
        for (let y = 0; y < 2; y++) for (let x = 0; x < 24; x++) {
            const bits = output.readUInt16BE(11 + (y * 24 + x) * 2);
            const exponent = (bits >>> 10) & 31, fraction = bits & 1023;
            const value = exponent === 0 ? fraction * 2 ** -24 : (1024 + fraction) * 2 ** (exponent - 25);
            expect(Math.abs(value - pixels[(1 - y) * 24 + x]! / 255)).toBeLessThan(0.0005);
        }
    });
}
for (const sync of [false, true]) it(`preserves 16-bit grayscale precision in PHM, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from("P5\n1 2\n65535\n"), Buffer.from([0, 1, 128, 1])]);
    const files = new Map<string, Uint8Array>([["input", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input", input);
    const args = ["input", "phm:-"];
    const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdoutBytes!);
    expect(output.subarray(0, 11).toString()).toBe("Ph\n1 2\n1.0\n");
    expect(output.length).toBe(15);
    expect(output.readUInt16BE(11)).toBe(0x3800);
    expect(output.readUInt16BE(13)).toBe(0x0100);
});

for (const sync of [false, true]) for (const inputEndian of ["MSB", "LSB"]) for (const endian of [undefined, "LSB", "MSB"]) {
    it(`writes PHM with input endian ${inputEndian}, output endian ${endian}, sync=${sync}`, async () => {
        // Native ImageMagick samples: 0.125 and 0.5, with matching scale sign and byte order.
        const input = Buffer.from(inputEndian === "LSB"
            ? "50660a3220310a2d312e300a0000003e0000003f"
            : "50660a3220310a312e300a3e0000003f000000", "hex");
        const files = new Map<string, Uint8Array>([["in.pfm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", input);
        const args = ["in.pfm", ...(endian ? ["-endian", endian] : []), "phm:-"];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe((endian ?? inputEndian) === "LSB"
            ? "50680a3220310a2d312e300a00300038"
            : "50680a3220310a312e300a30003800");
    });
}
