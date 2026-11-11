import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createIdentifyCommand, createConvertCommand, runIdentifyCli, runIdentifyCliSync, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a 2x1 green frame followed by a 1x1 red frame.
const gif = Buffer.from("R0lGODlhAgABAPAAAAD/AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgABAAACAgQKACH5BAAAAAAALAAAAAABAAEAgP8AAAAAAAICRAEAOw==", "base64");

for (const route of ["sync", "buffered", "retained", "magick", "standalone"] as const)
for (const identify of [false, true])
for (const [selector, dimensions, scenes] of [
    ["0,0", "2x1;", "0:0;"],
    ["0,0,0", "2x1;", "0:0;"],
    ["00,0", "2x1;", "0:0;"],
    ["-0,0", "2x1;", "0:0;"],
    ["0,", "2x1;", "0:0;"],
    ["1,1", "1x1;1x1;", "1:1;1:1;"]
] as const) {
    it(`${route}: ${identify ? "identify" : "convert"} GIF scenes [${selector}]`, async () => {
        const args = ["-format", identify ? "%s:%[fx:p{0,0}.r];" : "%wx%h;", `clip.gif[${selector}]`, ...(identify ? [] : ["info:"])];
        const files = new Map([["clip.gif", gif]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/clip.gif", gif);
        let result;
        if (route === "magick" || route === "standalone") {
            const command = route === "magick" ? createMagickCommand() : identify ? createIdentifyCommand() : createConvertCommand();
            const argumentValues = createCommandArguments(route === "magick" && identify ? ["identify", ...args] : args);
            let stdout = "", stderr = "";
            const status = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { ...status, stdout, stderr };
        } else if (route === "sync") result = (identify ? runIdentifyCliSync : runConvertCliSync)(args, files);
        else result = await (identify ? runIdentifyCli : runConvertCli)(args, route === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: identify ? scenes : dimensions, stderr: "" });
    });
}

it.each([
    ["0,1,0", "2x1:0;1x1:1;2x1:0;"],
    ["-2,-2", "2x1:0;2x1:0;"]
])("preserves repeated GIF scenes in [%s]", (selector, stdout) => {
    const files = new Map([["clip.gif", gif]]);
    expect(runConvertCliSync([`clip.gif[${selector}]`, "-format", "%wx%h:%[fx:p{0,0}.r];", "info:"], files))
        .toMatchObject({ exitCode: 0, stdout, stderr: "" });
});
