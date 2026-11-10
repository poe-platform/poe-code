import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ramp = [8,8,8,8,8,16,16,32,48,64,96,120,176,208,232,248];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["3x1+0%", [0,0,0,0,0,255,0,0,0,0,255,0,255,255,255,255]],
        ["5x1+5%", Array(16).fill(0)],
        ["5x1+3276.75", Array(16).fill(0)],
        ["3x1-5%", Array(16).fill(255)],
    ] as const)(`applies native local threshold %s via ${mode}`, async (geometry, expected) => {
        const input = new TextEncoder().encode(`P2\n16 1\n255\n${ramp.join(" ")}\n`);
        const files = new Map([["input.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["input.pgm", "-lat", geometry, "out.png"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const context = {
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext;
            expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode: 0 });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([16, 1]);
        expect([...image.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}

for (const mode of ["sync", "retained"] as const) {
    // Native ImageMagick Q16-HDRI, decoded to 8-bit RGB.
    it.each([
        ["P2\n4 2\n255\n10 50 90 130 170 210 250 20\n", "3x3", [], [0,0,0,255,255,255,255,0].flatMap(v => [v,v,v])],
        ["P2\n4 2\n255\n10 50 90 130 170 210 250 20\n", "2x2", [], [0,255,255,255,255,255,255,0].flatMap(v => [v,v,v])],
        ["P2\n3 1\n65535\n32768 32769 32768\n", "3x1", [], [0,0,0,255,255,255,0,0,0]],
        ["P3\n3 1\n255\n20 200 30 100 40 90 220 150 60\n", "3x1", [], [0,255,0,0,0,255,255,255,0]],
        ["P3\n3 1\n255\n20 200 30 100 40 90 220 150 60\n", "3x1", ["-channel", "R"], [0,200,30,0,40,90,255,150,60]],
    ] as const)(`matches native neighborhood and sample handling via ${mode}: %s %s %j`, async (input, geometry, options, expected) => {
        const bytes = new TextEncoder().encode(input), files = new Map([["input.pnm", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pnm", bytes);
        const args = ["input.pnm", ...options, "-lat", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png");
        expect([...decodeImage(output).data].filter((_, i) => i % 4 !== 3)).toEqual(expected);
    });
}

it.each(["", "bad", "3x1+NaN", "1001x1", "3x1x2"])("rejects invalid local threshold %s without replacing output", geometry => {
    const sentinel = new Uint8Array([1, 2, 3]);
    const files = new Map([["out.png", sentinel]]);
    expect(runConvertCliSync(["xc:red", "-lat", geometry, "out.png"], files).exitCode).not.toBe(0);
    expect(files.get("out.png")).toBe(sentinel);
});
