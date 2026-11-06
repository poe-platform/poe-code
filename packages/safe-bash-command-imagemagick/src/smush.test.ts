import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "./smush-fixtures.json" with { type: "json" };

// ImageMagick 7 native references, captured with -depth 8 rgba:-.
for (const mode of ["public", "sync"] as const) {
    it.each(fixtures)(`${mode} $name combines dimensions and pixels`, async ({ args, width, height, pixels }) => {
        const argumentValues = createCommandArguments([...args, "png:-"]);
        let bytes: Uint8Array;
        if (mode === "sync") {
            const result = runConvertCliSync(argumentValues.args, new Map());
            expect(result.exitCode).toBe(0);
            bytes = result.stdoutBytes!;
        } else {
            const chunks: number[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(...chunk); } },
                stderr: { async write(chunk) { expect(new TextDecoder().decode(chunk)).toBe(""); } },
            });
            expect(result.exitCode).toBe(0);
            bytes = Uint8Array.from(chunks);
        }
        const actual = decodeImage(bytes);
        expect([actual.width, actual.height]).toEqual([width, height]);
        expect([...actual.data]).toEqual(pixels);
    });
}
