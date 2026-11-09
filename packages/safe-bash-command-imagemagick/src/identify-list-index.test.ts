import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runConvertCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const extension of ["gif", "tiff"])
for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
it.each([
    { suffixes: ["[1]"], expected: "1/0|%p\n" },
    { suffixes: ["[1,0]"], expected: "1/0|%p\n0/1|%p\n" },
    { suffixes: ["[0-1]"], expected: "0/0|%p\n1/1|%p\n" },
    { suffixes: [""], expected: "0/0|%p\n1/1|%p\n" },
    { suffixes: ["[1]", "[0]"], expected: "1/0|%p\n0/0|%p\n" },
    { suffixes: ["", ""], expected: "0/0|%p\n1/1|%p\n0/0|%p\n1/1|%p\n" }
])(`identify expands the selected list index separately from the scene (${extension}, ${mode}): $suffixes`, async ({ suffixes, expected }) => {
    const path = `/movie.${extension}`, files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "2x3", "xc:blue", "xc:green", path], files)).toMatchObject({ exitCode: 0, stderr: "" });
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, files.get(path)!);
    const args = ["-format", "%s/%p|%%p\\n", ...suffixes.map(suffix => path + suffix)];
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
    expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
