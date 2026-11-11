import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const cases: [string[], string][] = [
    [["xc:red"], "Undefined"],
    ...["RLE", "None", "Zip", "LZW", "JPEG", "BZip"].flatMap((compression): [string[], string][] => [
        [["xc:red", "-compress", compression], compression],
        [["-compress", compression, "xc:red"], compression],
    ]),
    [["xc:red", "-compress", "RLE", "+compress"], "RLE"],
    [["xc:red", "-write", "mpr:a", "+delete", "mpr:a"], "Undefined"],
    [["xc:red", "-compress", "RLE", "-write", "mpr:a", "+delete", "mpr:a"], "RLE"],
    [["xc:red", "-compress", "RLE", "-write", "mpr:a", "+delete", "-compress", "None", "mpr:a"], "None"],
    [["xc:red", "-compress", "RLE", "-write", "mpr:a", "+delete", "+compress", "mpr:a"], "RLE"],
];

for (const mode of ["buffered", "retained", "public"] as const)
it.each(cases)(`reports active compression (${mode}) for %j`, async (input, compression) => {
    const argv = [...input, "-format", "%C|%[compression]", "info:"];
    const fs = new MemoryFileSystem();
    let result;
    if (mode === "public") {
        const args = createCommandArguments(argv);
        const stdout: string[] = [], stderr: string[] = [];
        const status = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(new TextDecoder().decode(chunk)); } },
            stderr: { async write(chunk) { stderr.push(new TextDecoder().decode(chunk)); } },
        });
        result = { ...status, stdout: stdout.join(""), stderr: stderr.join("") };
    } else {
        result = await runMagickCli(argv, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    }
    expect(result).toMatchObject({ exitCode: 0, stdout: `${compression}|${compression}`, stderr: "" });
});
