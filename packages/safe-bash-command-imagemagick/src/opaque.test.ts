import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Pixel expectations verified against ImageMagick 7.1.2.
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operator of ["-opaque", "+opaque"]) {
        it.each([
            ["#804020", undefined, false],
            ["#80402080", undefined, true],
            ["#81402080", undefined, false],
            ["#804020", "49%", false],
            ["#804020", "50%", true],
            ["#90402080", "1%", false],
            ["#90402080", "2%", true],
            ["#90402088", "3%", false],
            ["#90402088", "4%", true],
            ["#80402090", "4000", false],
            ["#80402090", "4200", true],
        ] as const)(`${mode}: ${operator} %s with fuzz %s`, async (target, fuzz, matched) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:#80402080", ...(fuzz === undefined ? [] : ["-fuzz", fuzz]), "-fill", "blue", operator, target, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual((operator === "-opaque" ? matched : !matched) ? [0, 0, 255, 255] : [128, 64, 32, 128]);
        });
    }
}

// Native ImageMagick: magick -size 1x1 xc:white -strip PNG:- / PNG24:-.
const grayPng = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010100000000376ef9240000000a4944415408d76368000000820081dd436af40000000049454e44ae426082", "hex");
const rgbPng = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fedccc59e70000000049454e44ae426082", "hex");
for (const mode of ["buffered", "sync", "command"] as const)
for (const source of [grayPng, rgbPng])
for (const operator of ["-opaque", "+opaque"])
it.each([
    ["red", [255, 0, 0, 255]],
    ["blue", [0, 0, 255, 255]],
    ["#123456", [18, 52, 86, 255]],
    ["#12345680", [18, 52, 86, 128]],
] as const)(`${mode}: PNG type ${source[25]} ${operator} fill %s preserves native channels`, async (fill, color) => {
    const files = new Map<string, Uint8Array>([["/in.png", source]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", source);
    const args = ["/in.png", "-fill", fill, operator, operator === "-opaque" ? "white" : "black", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const gray = source === grayPng;
    expect([...output.data]).toEqual(gray ? [color[2], color[2], color[2], color[3]] : [...color]);
    expect(output.space).toBe(gray ? "b-w" : "srgb");
    expect(output.hasAlpha).toBe(color[3] !== 255);
});
