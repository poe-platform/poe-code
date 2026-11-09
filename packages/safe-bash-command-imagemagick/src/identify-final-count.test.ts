import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runConvertCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const extension of ["gif", "tiff", "png"])
for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
// Expected output matches ImageMagick 7; %n remains present on every frame.
it.each(extension === "png" ? [{ suffixes: [""], expected: "1\n" }] : [
    { suffixes: ["[1]"], expected: "1\n|0|1|1" },
    { suffixes: ["[1,0]"], expected: "|0|1|22\n|1|0|2" },
    { suffixes: ["[0-1]"], expected: "|0|0|22\n|1|1|2" },
    { suffixes: [""], expected: "|0|0|22\n|1|1|2" },
    { suffixes: ["[1]", "[0]"], expected: "1\n|0|1|11\n|0|0|1" },
    { suffixes: ["", ""], expected: "|0|0|22\n|1|1|2|0|0|22\n|1|1|2" }
])(`identify emits the final selected list count (${extension}, ${mode}): $suffixes`, async ({ suffixes, expected }) => {
    const path = `/movie.${extension}`, files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "2x3", "xc:blue", ...(extension === "png" ? [] : ["xc:green"]), path], files)).toMatchObject({ exitCode: 0, stderr: "" });
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, files.get(path)!);
    const args = ["-format", extension === "png" ? "%N" : "%N|%p|%s|%n", ...(extension === "png" ? [path] : suffixes.map(suffix => path + suffix))];
    let result;
    if (mode === "sync") result = runIdentifyCliSync(args, files);
    else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
        const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
        let stdout = "", stderr = "";
        const status = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({ exitCode: 0, stdout: extension === "png" ? "1\n" : expected, stderr: "" });
});
