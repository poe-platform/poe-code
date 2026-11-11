import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Exact P6 streams verified with ImageMagick 7.1.2-35 Q16-HDRI.
const inputs = [
    Buffer.from("P3\n2 1\n255\n255 0 0 0 0 255\n"),
    Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("ff00000000ff", "hex")]),
];
const outputs = [
    { depth: 4, bytes: "50360a3220310a31350a0f000000000f" },
    { depth: 8, bytes: "50360a3220310a3235350aff00000000ff" },
    { depth: 10, bytes: "50360a3220310a313032330a03ff000000000000000003ff" },
    { depth: 16, bytes: "50360a3220310a36353533350affff0000000000000000ffff" },
];
for (const sync of [false, true]) for (const input of inputs) for (const { depth, bytes } of outputs) {
    for (const destination of ["out.pnm", "pnm:out.bin", "pnm:-"]) for (const write of [false, true]) {
        it(`keeps color PNM binary with -compress None: ${input.subarray(0, 2)}, depth=${depth}, ${destination}, sync=${sync}, write=${write}`, async () => {
            const files = new Map<string, Uint8Array>([["in.pnm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pnm", input);
            const args = ["in.pnm", "-depth", String(depth), "-compress", "None", ...(write ? ["-write", destination, "null:"] : [destination])];
            const result = sync ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const path = destination === "out.pnm" ? "out.pnm" : "out.bin";
            const actual = destination === "pnm:-" ? result.stdoutBytes : sync ? files.get(path) : await filesystem.readFile("/" + path);
            expect(Buffer.from(actual!)).toEqual(Buffer.from(bytes, "hex"));
        });
    }
}

for (const sync of [false, true]) for (const fixture of [
    { format: "ppm", pixels: "ff00000000ff", tokens: ["P3", "2", "1", "255", "255", "0", "0", "0", "0", "255"] },
    { format: "pnm", pixels: "343434ababab", tokens: ["P2", "2", "1", "255", "52", "171"] },
    { format: "pnm", pixels: "000000ffffff", tokens: ["P1", "2", "1", "1", "0"] },
]) it(`preserves plain ${fixture.tokens[0]} output with -compress None, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from(fixture.pixels, "hex")]);
    const files = new Map([["in.pnm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pnm", input);
    const args = ["in.pnm", "-depth", "8", "-compress", "None", `${fixture.format}:-`];
    const result = sync ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stdoutBytes!).toString().trim().split(/\s+/)).toEqual(fixture.tokens);
});
