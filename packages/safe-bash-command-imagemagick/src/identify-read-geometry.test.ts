import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

const ppm = new TextEncoder().encode("P3\n2 1\n255\n255 0 0 0 255 0\n");
// Native ImageMagick: magick -size 2x3 xc:blue xc:green movie.gif
const gif = Uint8Array.from(Buffer.from("R0lGODlhAgADAPAAAAAA/wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgADAAACAoRfACH5BAAAAAAALAAAAAACAAMAgACAAAAAAAIChF8AOw==", "base64"));

for (const mode of ["sync", "buffered", "retained", "identify", "magick"]) {
    it.each([
        ["b.ppm[1x1+1+0]", "%wx%h;", "1x1;"],
        ["b.ppm[1x1]", "%wx%h;", "1x1;"],
        ["b.ppm", "%wx%h;", "2x1;"],
        ["b.ppm[+1+0]", "%wx%h;", "2x1;"],
        ["PPM:b.ppm[1x1+1+0]", "%wx%h;", "1x1;"],
        ["b.ppm[1x1+1+0]", "%[fx:mean.r]/%[fx:mean.g];", "0/1;"],
        ["b.ppm[literal]", "%wx%h;", "2x1;"],
        ["movie.gif[1x1]", "%wx%h:%s/%p/%n;", "1x1:0/0/2;1x1:1/1/2;"],
        ["movie.gif[1x1+1+0]", "%wx%h:%s/%p/%n;", "1x1:0/0/2;1x1:1/1/2;"],
        ["movie.gif[1]", "%wx%h:%s/%p/%n;", "2x3:1/0/1;"],
        ["movie.gif[1,0]", "%wx%h:%s/%p/%n;", "2x3:1/0/2;2x3:0/1/2;"]
    ])(`${mode}: identify reads %s`, async (path, format, stdout) => {
        const files = new Map([["b.ppm", ppm], ["b.ppm[literal]", ppm], ["movie.gif", gif]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const args = ["-format", format, path];
        let result;
        if (mode === "sync") result = runIdentifyCliSync(args, files);
        else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        else {
            const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
            const argumentValues = createCommandArguments(mode === "magick" ? ["identify", ...args] : args);
            let output = "", stderr = "";
            const status = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { ...status, stdout: output, stderr };
        }
        expect(result).toEqual({ exitCode: 0, stdout, stderr: "" });
    });
}

for (const retained of [false, true]) {
    it(`identifies cropped dimensions and pixels in verbose output (retained=${retained})`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/b.ppm", ppm);
        const result = await runIdentifyCli(["-verbose", "b.ppm[1x1+1+0]"], retained ? { filesystem: fs, cwd: "/" } : new Map([["b.ppm", ppm]]));
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout).toContain("Geometry: 1x1+0+0");
        expect(result.stdout).toContain("Colors: 1");
        expect(result.stdout).toContain("#00FF00");
        expect(result.stdout).not.toContain("#FF0000");
    });

    it(`reports a missing bracketed input without skipping later images (retained=${retained})`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/b.ppm", ppm);
        const result = await runIdentifyCli(["-format", "%wx%h;", "missing.ppm[1x1]", "b.ppm[1x1]"], retained ? { filesystem: fs, cwd: "/" } : new Map([["b.ppm", ppm]]));
        expect(result).toEqual({ exitCode: 1, stdout: "1x1;", stderr: "identify: unable to open image 'missing.ppm[1x1]': No such file or directory\n" });
    });
}
