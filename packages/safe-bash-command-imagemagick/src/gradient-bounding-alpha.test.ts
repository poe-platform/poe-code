import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        {
            input: "gradient:red-none", bounded: true, composite: false,
            pixels: "ff000000 ff000000 ff000000 ff000000 ff000000 ff000000 ff000080 ff000080 ff000000 ff000000 ff000000 00000000 00000000 ff000000 ff000000"
        },
        {
            input: "gradient:red-none", bounded: true, composite: true,
            pixels: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ff8080ff ff8080ff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff"
        },
        {
            input: "radial-gradient:#ff000040-blue", bounded: true, composite: false,
            pixels: "ff000000 ff000000 ff000000 ff000000 ff000000 ff000000 3300cca0 ff000040 ff000000 ff000000 ff000000 1800e7c7 3300cca0 ff000000 ff000000"
        },
        {
            input: "gradient:#ff000000-blue", bounded: true, composite: false,
            pixels: "ff000000 ff000000 ff000000 ff000000 ff000000 ff000000 0000ff80 0000ff80 ff000000 ff000000 ff000000 0000ffff 0000ffff ff000000 ff000000"
        },
        {
            input: "gradient:red-blue", bounded: true, composite: false,
            pixels: "ff0000ff ff0000ff ff0000ff ff0000ff ff0000ff ff0000ff 800080ff 800080ff ff0000ff ff0000ff ff0000ff 0000ffff 0000ffff ff0000ff ff0000ff"
        },
        {
            input: "gradient:red-none", bounded: false, composite: false,
            pixels: "ff0000ff ff0000ff ff0000ff ff0000ff ff0000ff ff000080 ff000080 ff000080 ff000080 ff000080 00000000 00000000 00000000 00000000 00000000"
        }
    ])(`${mode}: $input bounded=$bounded composite=$composite`, async ({ input, bounded, composite, pixels }) => {
        const argv = ["-size", "5x3", ...(bounded ? ["-define", "gradient:bounding-box=2x2+1+1"] : []), input,
            ...(composite ? ["-background", "white", "-alpha", "remove"] : []), "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let bytes: Buffer;
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            const stdout: Buffer[] = [], stderr: Buffer[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString("hex")).toBe(pixels.replaceAll(" ", ""));
    });
}
