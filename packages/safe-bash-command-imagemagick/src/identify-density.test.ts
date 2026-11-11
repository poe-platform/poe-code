import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runConvertCliSync } from "./index.js";

// Status, output, and diagnostic meaning checked against native ImageMagick 7.
for (const mode of ["buffered", "retained", "sync", "identify", "magick"]) {
    it.each([
        { name: "default resolution", args: ["-format", "%x|%y", "a.ppm"], stdout: "72|72" },
        { name: "independent axes", args: ["-density", "81x93", "-format", "%x|%y", "a.ppm"], stdout: "81|93" },
        { name: "single density", args: ["-density", "81", "-format", "%x|%y", "a.ppm"], stdout: "81|81" },
        { name: "per-input density", args: ["-format", "%f:%x|%y;", "a.ppm", "-density", "81x93", "b.ppm"], stdout: "a.ppm:72|72;b.ppm:81|93;" },
        { name: "reset density", args: ["-density", "81x93", "-format", "%x|%y;", "a.ppm", "+density", "b.ppm"], stdout: "81|93;72|72;" },
        { name: "bracketed resolution", args: ["-density", "81x93", "-format", "%[resolution.x]|%[resolution.y]", "a.ppm"], stdout: "81|93" },
        { name: "embedded resolution", args: ["-density", "81x93", "-format", "%x|%y|%U", "tagged.png"], stdout: "81|93|PixelsPerCentimeter" },
        { name: "verbose resolution", args: ["-density", "81x93", "-verbose", "a.ppm"], stdout: "  Resolution: 81x93\n" },
        { name: "FX resolution", args: ["-density", "81x93", "-format", "%[fx:resolution.x]|%[fx:resolution.y]", "a.ppm"], stdout: "81|93" },
        { name: "expanded frames", args: ["-density", "81x93", "-format", "%s:%x|%y;", "pages.tiff"], stdout: "0:81|93;1:81|93;" },
        { name: "selected frames", args: ["-density", "81x93", "-format", "%s:%x|%y;", "pages.tiff[1,0]"], stdout: "1:81|93;0:81|93;" },
        { name: "missing density after input", args: ["-format", "%f:%wx%h;", "a.ppm", "-density"], stdout: "a.ppm:1x1;", stderr: "identify: missing an argument for option '-density'\n" },
        { name: "missing density before input", args: ["-density"], stdout: "", stderr: "identify: missing an argument for option '-density'\n" },
        { name: "invalid density stops later inputs", args: ["-format", "%f:%wx%h;", "a.ppm", "-density", "bad", "b.ppm"], stdout: "a.ppm:1x1;", stderr: "identify: invalid argument for option '-density': bad\n" },
        { name: "missing file preserves later input", args: ["-density", "81x93", "-format", "%f:%x|%y;", "missing.ppm", "b.ppm"], stdout: "b.ppm:81|93;", stderr: "identify: unable to open image 'missing.ppm': No such file or directory\n" }
    ])(`identify density (${mode}): $name`, async ({ args, stdout, stderr = "" }) => {
        const files = new Map([
            ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
            ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
        ]);
        if (args.some(arg => arg.startsWith("pages.tiff"))) {
            expect(runConvertCliSync(["a.ppm", "b.ppm", "pages.tiff"], files)).toMatchObject({ exitCode: 0, stderr: "" });
        }
        if (args.includes("tagged.png")) files.set("tagged.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAC4jAAAXEgGVQubbAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"));
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        let result;
        if (mode === "sync") result = runIdentifyCliSync(args, files);
        else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        else {
            const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
            const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
            let output = "", errors = "";
            const status = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } }
            });
            result = { ...status, stdout: output, stderr: errors };
        }
        if (args.includes("-verbose")) {
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(result.stdout).toContain(stdout);
        }
        else expect(result).toEqual({ exitCode: stderr ? 1 : 0, stdout, stderr });
    });
}
