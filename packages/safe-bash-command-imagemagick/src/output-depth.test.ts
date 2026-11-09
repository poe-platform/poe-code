import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Byte streams checked against native ImageMagick, independently of our reader.
for (const sync of [false, true]) for (const [depth, maxval, hex] of [
    [1, 1, "000001010000"],
    [10, 1023, "0049011502260337004e0091"],
    [4, 15, "0104080c0102"],
    [8, 255, "124589cd1324"],
    [16, 65535, "1234456789abcdef13792468"]
] as const) it(`encodes depth ${depth}, sync=${sync}`, async () => {
    const input = Buffer.from("89504e470d0a1a0a0000000d49484452000000020000000110020000002bd0349e000000154944415408d7631032714def5c7df6bd70a54a06001e4704fbc6818eec0000000049454e44ae426082", "hex");
    const argv = ["in.png", "-depth", String(depth), "out.ppm"];
    const expected = Buffer.concat([Buffer.from(`P6\n2 1\n${maxval}\n`), Buffer.from(hex, "hex")]);
    if (sync) {
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const result = runMagickCliSync(argv, files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(files.get("out.ppm")!)).toEqual(expected);
    } else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(await fs.readFile("/out.ppm"))).toEqual(expected);
    }
});

for (const sync of [false, true]) it(`resets output to quantum depth and captures write depth, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([17, 68, 136])]);
    const argv = ["in.ppm", "-depth", "4", "-write", "low.ppm", "+depth", "out.ppm"];
    const files = new Map<string, Uint8Array>([["in.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const result = sync ? runMagickCliSync(argv, files) : await runMagickCli(argv, { filesystem: fs, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(sync ? files.get("out.ppm")! : await fs.readFile("/out.ppm"))).toEqual(Buffer.concat([Buffer.from("P6\n1 1\n65535\n"), Buffer.from([17, 17, 68, 68, 136, 136])]));
    expect(Buffer.from(sync ? files.get("low.ppm")! : await fs.readFile("/low.ppm"))).toEqual(Buffer.concat([Buffer.from("P6\n1 1\n15\n"), Buffer.from([1, 4, 8])]));
});
