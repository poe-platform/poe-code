import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runConvertCliSync } from "./index.js";

// ImageMagick: magick -size 2x3 xc:blue xc:green gif:-
const gif = new Uint8Array(Buffer.from("R0lGODlhAgADAPAAAAAA/wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgADAAACAoRfACH5BAAAAAAALAAAAAACAAMAgACAAAAAAAIChF8AOw==", "base64"));

for (const route of ["sync", "buffered", "filesystem", "command", "identify"] as const)
for (const [format, operands, expected] of [
    ["gif", ["movie.gif[1]"], "1/1|1/1;"],
    ["gif", ["movie.gif"], "0/2|0/2;1/2|1/2;"],
    ["gif", ["movie.gif[1,0,1]"], "1/3|1/3;0/3|0/3;1/3|1/3;"],
    ["tiff", ["movie.tiff[1]"], "1/1|1/1;"],
    ["tiff", ["movie.tiff"], "0/2|0/2;1/2|1/2;"],
    ["tiff", ["movie.tiff", "movie.tiff[1]"], "0/2|0/2;1/2|1/2;1/1|1/1;"],
] as const) {
    it(`reports selected list length and original scene (${route}, ${operands.join(" ")})`, async () => {
        const files = new Map([["movie.gif", gif]]);
        if (format === "tiff") {
            expect(runConvertCliSync(["-size", "2x3", "xc:blue", "xc:green", "movie.tiff"], files).exitCode).toBe(0);
        }
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile(`/movie.${format}`, files.get(`movie.${format}`)!);
        const args = ["-format", "%[scene]/%[scenes]|%s/%n;", ...operands];
        let result;
        if (route === "command" || route === "identify") {
            const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
            const argumentValues = createCommandArguments(route === "command" ? ["identify", ...args] : args);
            let stdout = "", stderr = "";
            const status = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            result = { ...status, stdout, stderr };
        } else result = route === "sync" ? runIdentifyCliSync(args, files)
            : await runIdentifyCli(args, route === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
