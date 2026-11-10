import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const input = ["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append"];
// Native ImageMagick 7.1.2-35 Q16-HDRI destination contents.
const palette = "a85040ff706b3bff706b3bffa85040ffa85040ff";

for (const mode of ["public", "sync"]) {
    for (const space of ["Lab", "HSL"]) {
        for (const convertBack of [false, true]) {
            for (const format of ["info", "rgba"]) {
                it(`keeps the reduced ${space} palette, sRGB conversion=${convertBack}, ${format} (${mode})`, async () => {
                    const args = [...input, "-colorspace", space, "+dither", "-colors", "2",
                        ...(convertBack ? ["-colorspace", "sRGB"] : []),
                        ...(format === "info" ? ["-format", "%r|%k"] : ["-depth", "8"]), `${format}:/out`];
                    const output = await execute(args, mode);
                    expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex"))
                        .toBe(format === "info" ? "PseudoClass sRGB |2" : palette);
                });
            }
        }
    }

    for (const [name, args, expected] of [
        ["unquantized Lab classification", ["-colorspace", "Lab", "-colorspace", "sRGB", "-format", "%r|%k", "info:/out"], "DirectClass sRGB |5"],
        ["unquantized Lab 16-bit samples", ["-colorspace", "Lab", "-colorspace", "sRGB", "-endian", "MSB", "-depth", "16", "rgba:/out"], "b0b230261009ffff3031201f100fffff5052504f807fffffa0a2706d706fffffd0d3d0ce2018ffff"],
        ["sRGB quantization", ["+dither", "-colors", "2", "-depth", "8", "rgba:/out"], palette],
    ] as const) {
        it(`preserves ${name} (${mode})`, async () => {
            const output = await execute([...input, ...args], mode);
            expect(args.at(-1) === "info:/out" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}

async function execute(args: string[], mode: string): Promise<Uint8Array> {
    const sentinel = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", sentinel]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", sentinel);
    const argumentValues = createCommandArguments(args);
    const result = mode === "public" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext) : runConvertCliSync(args, files);
    expect(result.exitCode).toBe(0);
    return mode === "public" ? fs.readFile("/out") : files.get("/out")!;
}
