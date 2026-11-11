import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// PNG32 fixture and expected P6 bytes verified with native ImageMagick and od.
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000010806000000f4227f8a000000114944415408d7631032096b587df6bd03000dba03c49aeb799b0000000049454e44ae426082", "hex");
const fixtures = [
    { name: "color", input: png, output: Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("123456abcdef", "hex")]) },
    { name: "gray", input: Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("343434ababab", "hex")]), output: Buffer.concat([Buffer.from("P5\n2 1\n255\n"), Buffer.from("34ab", "hex")]) },
    { name: "16-bit color", input: Buffer.concat([Buffer.from("P6\n1 1\n65535\n"), Buffer.from("123412351234", "hex")]), output: Buffer.concat([Buffer.from("P6\n1 1\n65535\n"), Buffer.from("123412351234", "hex")]) },
    { name: "16-bit gray", input: Buffer.concat([Buffer.from("P5\n1 1\n65535\n"), Buffer.from("0001", "hex")]), output: Buffer.concat([Buffer.from("P5\n1 1\n65535\n"), Buffer.from("0001", "hex")]) },
    { name: "bilevel", input: Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("000000ffffff", "hex")]), output: Buffer.concat([Buffer.from("P4\n2 1\n"), Buffer.from([128])]) },
];
for (const sync of [false, true]) for (const fixture of fixtures) {
    for (const destination of ["out.pnm", "pnm:out.bin", "PNM:-"]) for (const write of [false, true]) {
        it(`writes ${fixture.name} PNM to ${destination}, sync=${sync}, write=${write}`, async () => {
            const files = new Map<string, Uint8Array>([["input", fixture.input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input", fixture.input);
            const args = ["input", ...(write ? ["-write", destination, "null:"] : [destination])];
            const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const path = destination === "out.pnm" ? "out.pnm" : "out.bin";
            const output = destination === "PNM:-" ? result.stdoutBytes : sync ? files.get(path) : await filesystem.readFile("/" + path);
            expect(Buffer.from(output!)).toEqual(fixture.output);
        });
    }
}

for (const sync of [false, true]) it(`honors ASCII and depth settings for PNM, sync=${sync}`, async () => {
    const files = new Map<string, Uint8Array>([["input", fixtures[1]!.input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input", fixtures[1]!.input);
    const args = ["input", "-depth", "4", "-compress", "None", "pnm:-"];
    const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stdoutBytes!).toString().trim().split("\n").flatMap(line => line.split(" ")).filter(Boolean)).toEqual(["P2", "2", "1", "255", "51", "170"]);
});
