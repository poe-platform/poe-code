import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runConvertCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"] as const) {
    it.each([
        { name: "repeated filenames", args: ["-format", "one;", "/photo.png", "-format", "two;", "/photo.png"], expected: "one;two;" },
        { name: "filename and dimension expansion", args: ["-format", "%f:%wx%h;", "/photo.png", "-format", "%h/%w:%f;", "/other.png"], expected: "photo.png:3x2;4/5:other.png;" },
        { name: "initial default format", args: ["/photo.png", "-format", "two;", "/other.png"], expected: "default" },
        { name: "trailing format", args: ["/photo.png", "-format", "unused;"], expected: "default-only" },
        { name: "empty format", args: ["-format", "", "/photo.png", "-format", "two;", "/other.png"], expected: "two;" },
        { name: "long option alias", args: ["--format", "one;", "/photo.png", "--format", "two;", "/other.png"], expected: "one;two;" },
        { name: "expanded TIFF pages", args: ["-format", "one:%s;", "/pages.tiff", "-format", "two;", "/photo.png"], expected: "one:0;one:1;two;" },
        { name: "selected TIFF pages", args: ["-format", "one:%s;", "/pages.tiff[1,0]", "-format", "two;", "/photo.png"], expected: "one:1;one:0;two;" }
    ])(`uses the format active at each operand (${mode}, $name)`, async ({ args, expected }) => {
        const photo = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } }).png().toBuffer();
        const other = await sharp({ create: { width: 5, height: 4, channels: 3, background: "blue" } }).png().toBuffer();
        const files = new Map<string, Uint8Array>([["/photo.png", photo], ["/other.png", other]]);
        if (args.some(arg => arg.startsWith("/pages.tiff"))) {
            expect(runConvertCliSync(["/photo.png", "/other.png", "/pages.tiff"], files)).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
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
        const defaultLine = `/photo.png PNG 3x2 3x2+0+0 8-bit sRGB ${photo.length}B 0.000u 0:00.000\n`;
        const stdout = expected === "default" ? defaultLine + "two;" : expected === "default-only" ? defaultLine : expected;
        expect(result).toEqual({ exitCode: 0, stdout, stderr: "" });
    });
}
