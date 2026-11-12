import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI treats decoration colors as ink values.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "CMYK", compose: "Copy", expected: "dfbfdf404080c080dfbfdf40" },
        { space: "CMYK", compose: "Multiply", expected: "dfbfdf40799fd4a0dfbfdf40" },
        { space: "CMYK", compose: "Xor", expected: "dfbfdf40aac3e480dfbfdf40" },
        { space: "CMYK", compose: "Over", expected: "dfbfdf405a8cc7a0dfbfdf40" },
        { space: "sRGB", compose: "Copy", expected: "204020404080c08020402040" },
    ])(`${mode}: composites translucent $space borders with $compose`, async ({ space, compose, expected }) => {
        const argv = ["xc:#4080c080", "-alpha", "On", "-colorspace", space, "-bordercolor", "#20402040",
            "-compose", compose, "-border", "1x0", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
    for (const operation of ["-border", "-frame"]) {
        it.each([
            { space: "CMYK", convert: false, output: "cmyk", padding: "80502000", center: "996600af" },
            { space: "CMYK", convert: true, output: "rgba", padding: "7fafdfff", center: "203050ff" },
            { space: "CMYK", depth: "16", convert: false, output: "cmyk", padding: "8080505020200000", center: "999966660000afaf" },
            { space: "CMYK", depth: "16", convert: true, output: "rgba", padding: "7f7fafafdfdfffff", center: "202030305050ffff" },
            { space: "sRGB", convert: true, output: "rgba", padding: "805020ff", center: "203050ff" },
        ])(`${mode}: ${operation} preserves $space padding and source pixels ($output, depth=$depth, convert=$convert)`, async ({ space, depth = "8", convert, output, padding, center }) => {
            const argv = ["xc:#203050", "-colorspace", space, "-mattecolor", "#805020", "-bordercolor", "#805020",
                operation, "1x1", ...(convert ? ["-colorspace", "sRGB"] : []), "-depth", depth, "-endian", "MSB", `${output}:-`];
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let bytes: Buffer;
            if (mode === "command") {
                const argumentValues = createCommandArguments(argv), stdout: Buffer[] = [], stderr: Buffer[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
                });
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(stderr).toString()).toBe("");
                bytes = Buffer.concat(stdout);
            } else {
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
            }
            expect(bytes.toString("hex")).toBe(padding.repeat(4) + center + padding.repeat(4));
        });
    }
}
