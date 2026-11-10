import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGB output.
for (const mode of ["public", "sync"] as const)
it.each([
    [[], [], "00073086d6ffff0000197dd9e1ff00184280d9ffff00003383d6ffff0016577dcdffff00053589e8ffff002052"],
    [["-write-mask", "/mask.pgm"], ["+write-mask"], "000d367a9fc4ff0000587da2d7ff00365b80c0e6ff14395e83c3e8f2173c6186d3d0f51a194495aed3f800295b"],
    [["-region", "2x2+1+1"], ["+region"], "0b30557a9fc4e90e33587da2c7ec11365b80d6fcff000e4683a8cdf2173c6186abffff00003a89aed3f81d4267"]
] as const)(`matches native unsharp with %j (${mode})`, async (before, after, expected) => {
    const files = new Map([
        ["/pic.ppm", Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => (11 + i * 37) % 256))])],
        ["/mask.pgm", Buffer.concat([Buffer.from("P5\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => i % 2 * 255))])]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, data] of files) await fs.writeFile(path, data);
    const args = ["/pic.ppm", ...before, "-unsharp", "0x1", ...after, "-depth", "8", "rgb:/out.rgb"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb")).toString("hex")).toBe(expected);
});
