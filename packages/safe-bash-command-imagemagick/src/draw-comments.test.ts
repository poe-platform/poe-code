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
    it.each([
        ["# ignore\nrectangle 1,1 2,2", "rectangle 1,1 2,2"],
        ["fill '#0000ff' point 1,1 # a comment\npoint 2,1", "fill '#0000ff' point 1,1 point 2,1"],
        ['fill "#0000ff" # ignore\npoint 2,1', "fill blue point 2,1"],
        ["# ' unmatched quote\n# second comment\npoint 1,1 # trailing comment", "point 1,1"],
        ["# comment only", ""],
    ])(`${mode}: renders comments like the uncommented control: %s`, async (primitive, control) => {
        const actual = await draw(primitive, mode);
        const expected = await draw(control, mode);
        expect(actual.result.exitCode).toBe(0);
        expect(expected.result.exitCode).toBe(0);
        expect(decodeImage(actual.bytes)).toEqual(decodeImage(expected.bytes));
        if (control === "rectangle 1,1 2,2") {
            const image = decodeImage(actual.bytes);
            for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) {
                expect([...image.data.subarray((y * 7 + x) * 4, (y * 7 + x + 1) * 4)])
                    .toEqual(x >= 1 && x <= 2 && y >= 1 && y <= 2 ? [255, 0, 0, 255] : [255, 255, 255, 255]);
            }
        }
    });

    it(`${mode}: preserves the destination when a command after a comment is invalid`, async () => {
        const { result, bytes } = await draw("point 1,1 # ignore\nrectangle 1,1", mode);
        expect(result.exitCode).not.toBe(0);
        expect(new TextDecoder().decode(bytes)).toBe("keep");
    });
}
