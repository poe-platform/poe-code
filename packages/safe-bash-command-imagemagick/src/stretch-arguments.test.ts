import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [10, 140, 45, 10, 140, 45, 90, 60, 110, 105, 195, 130, 165, 45, 180, 200, 80, 220, 200, 80, 220];
const input = encodeImage({ width: 7, height: 1,
    data: Uint8Array.from(pixels.flatMap((value, i) => i % 3 === 2 ? [value, 255] : [value])),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
}, { format: "png" }).data;
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-linear-stretch", "-contrast-stretch"]) {
        async function convert(argument: string, settings: string[] = []) {
            const files = new Map([["in.png", input], ["out.png", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            await fs.writeFile("/out.png", keep);
            const argv = ["in.png", ...settings, operation, argument, "out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            return { result, output, stderr: "stderr" in result ? result.stderr : stderr };
        }

        it.each(["bogus", "x2", "1bogus", ""])(`${mode}: rejects ${operation} %j and preserves destination`, async argument => {
            const { result, output, stderr } = await convert(argument);
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("invalid argument");
            expect(stderr).toContain(operation);
            expect(output).toEqual(keep);
        });

        it.each([
            ["%[fx:w]x10%", "7x10%", []],
            ["1x%[fx:h+1]", "1x2", []],
            ["%[clip]x%[option:white]", "1x2", ["-set", "clip", "1", "-set", "option:white", "2"]],
        ] as const)(`${mode}: expands ${operation} %s before parsing clipping points`, async (argument, literal, settings) => {
            const expected = await convert(literal);
            const actual = await convert(argument, [...settings]);
            expect(expected.result.exitCode).toBe(0);
            expect(actual.result.exitCode).toBe(0);
            expect(decodeImage(actual.output).data).toEqual(decodeImage(expected.output).data);
        });

        it(`${mode}: rejects invalid expanded ${operation} and preserves destination`, async () => {
            const { result, output, stderr } = await convert("%[clip]", ["-set", "clip", "bogus"]);
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("invalid argument");
            expect(output).toEqual(keep);
        });

        it(`${mode}: matches native ${operation} 1x2 pixels`, async () => {
            // ImageMagick 7.1.2-31 Q16-HDRI, magick in.png <operation> 1x2 -depth 8 rgb:-
            const expected = operation === "-linear-stretch"
                ? [0, 255, 0, 0, 255, 0, 112, 0, 224, 196, 255, 255, 255, 0, 255, 255, 56, 255, 255, 56, 255]
                : [0, 255, 0, 0, 255, 0, 70, 0, 214, 178, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255];
            const { result, output } = await convert("1x2");
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(output).data].filter((_, i) => i % 4 !== 3)).toEqual(expected);
        });
    }
}
