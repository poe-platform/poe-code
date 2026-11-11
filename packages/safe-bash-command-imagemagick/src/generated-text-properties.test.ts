import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCliSync } from "./index.js";

const font = new Uint8Array(readFileSync(new URL("./fixtures/DejaVuSans.ttf", import.meta.url)));

// Expected properties verified with native ImageMagick and the same font bytes.
for (const mode of ["buffered", "magick", "convert"] as const) {
    it.each([
        { input: ["label:Hi"], format: "%m|%f|%[label]", expected: "LABEL|Hi|Hi" },
        { input: ["caption:Hi"], format: "%m|%f|%[caption]|%[caption:lines]", expected: "CAPTION|Hi|Hi|1" },
        { input: ["caption:one two three"], format: "%[caption]|%[caption:lines]", expected: "one two three|3" },
        { input: ["-size", "70x64", "caption:one two three"], format: "%[caption:lines]", expected: "2" },
        { input: ["+font", "label:Hi"], format: "%m|%f|%[label]", expected: "LABEL|Hi|Hi" },
        { input: ["caption:Hi", "-write", "mpr:text", "+delete", "mpr:text"], format: "%m|%[caption]|%[caption:lines]", expected: "CAPTION|Hi|1" },
        { input: ["caption:one\ntwo"], format: "%[caption]|%[caption:lines]", expected: "one\ntwo|2" },
        { input: ["label:Hi", "+clone"], format: "%m|%f|%l;", expected: "LABEL|Hi|Hi;LABEL|Hi|Hi;" },
        { input: ["xc:red", "-set", "label", "Hi"], format: "%[label]", expected: "Hi" }
    ])(`${mode}: $input`, async ({ input, format, expected }) => {
        const files = new Map([["font.ttf", font]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/font.ttf", font);
        const args = ["-font", "font.ttf", "-pointsize", "12", "-size", "35x64", ...input, "-format", format, "info:"];
        let stdout = "", stderr = "";
        const result = mode === "buffered" ? runMagickCliSync(args, files) : {
            ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        };
        expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
