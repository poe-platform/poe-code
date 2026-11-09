import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

async function draw(primitive: string, mode: string) {
    const initial = new TextEncoder().encode("keep");
    const argv = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", primitive, "out.png"];
    if (mode === "memory") {
        const files = new Map([["out.png", initial]]);
        const result = await runConvertCli(argv, files);
        return { result, bytes: files.get("out.png")! };
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out.png", initial);
    const argumentValues = createCommandArguments(argv);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs,
    } as unknown as CommandContext;
    const result = await createMagickCommand().execute(context);
    return { result, bytes: await fs.readFile("/out.png") };
}

for (const mode of ["memory", "command"]) {
    it.each(["NaN", "nan", "NAN", "+NaN", "-NaN"])(`${mode}: draws a %s rectangle endpoint like the native finite control`, async coordinate => {
        const actual = await draw(`rectangle 1,1 ${coordinate},2`, mode);
        const control = await draw("rectangle 1,1 1,2", mode);
        expect(actual.result.exitCode).toBe(0);
        expect(control.result.exitCode).toBe(0);
        const image = decodeImage(actual.bytes);
        expect(image).toEqual(decodeImage(control.bytes));
        expect([image.width, image.height]).toEqual([7, 5]);
        for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) {
            expect([...image.data.subarray((y * 7 + x) * 4, (y * 7 + x + 1) * 4)])
                .toEqual(x === 1 && (y === 1 || y === 2) ? [255, 0, 0, 255] : [255, 255, 255, 255]);
        }
    });

    it(`${mode}: collapses a NaN vertical endpoint onto the starting row`, async () => {
        const actual = await draw("rectangle 1,1 3,NaN", mode);
        const control = await draw("rectangle 1,1 3,1", mode);
        expect(actual.result.exitCode).toBe(0);
        expect(control.result.exitCode).toBe(0);
        expect(decodeImage(actual.bytes)).toEqual(decodeImage(control.bytes));
    });

    it.each(["Infinity", "bad"])(`${mode}: preserves the destination for an invalid rectangle endpoint: %s`, async coordinate => {
        const { result, bytes } = await draw(`rectangle 1,1 ${coordinate},2`, mode);
        expect(result.exitCode).not.toBe(0);
        expect(new TextDecoder().decode(bytes)).toBe("keep");
    });
}
