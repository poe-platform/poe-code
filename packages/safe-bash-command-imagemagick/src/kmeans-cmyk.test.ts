import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete raw output and palette metadata.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["1", [], "cmyk:out", "aaaaaa00aaaaaa00aaaaaa00"],
        ["2", [], "cmyk:out", "00ffff00ff808000ff808000"],
        ["3", [], "cmyk:out", "00ffff00ff00ff00ffff0000"],
        ["1", ["-format", "%r|%k"], "info:out", "PseudoClass CMYK |1"],
        ["1", ["-colorspace", "sRGB"], "rgba:out", "555555ff555555ff555555ff"],
        [null, ["-colorspace", "sRGB"], "rgba:out", "ff0000ff00ff00ff0000ffff"],
    ] as const)(`${mode}: clusters CMYK into %s colors with %j`, async (colors, options, destination, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["out", sentinel]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argv = ["-seed", "7", "xc:red", "xc:lime", "xc:blue", "+append", "-colorspace", "CMYK",
            ...(colors === null ? [] : ["-kmeans", colors]), ...options, "-depth", "8", destination];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(destination.startsWith("info:") ? "utf8" : "hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it(`averages 16-bit ink and alpha independently across chunks (retained=${retained})`, async () => {
        const width = 1028, input = new Uint8Array(width * 10), view = new DataView(input.buffer);
        const expected = new Uint8Array(input.length), expectedView = new DataView(expected.buffer);
        for (let pixel = 0; pixel < width; pixel++) for (let channel = 0; channel < 5; channel++) {
            view.setUint16(pixel * 10 + channel * 2, 10001 + channel * 10000 + (pixel % 2) * 2);
            expectedView.setUint16(pixel * 10 + channel * 2, 10002 + channel * 10000);
        }
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const result = await runMagickCli(["-size", `${width}x1`, "-depth", "16", "-endian", "MSB",
            "cmyka:input", "-kmeans", "1", "cmyka:out"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(retained ? await fs.readFile("/out") : files.get("out")).toEqual(expected);
    });
}

for (const retained of [false, true]) {
    it(`replaces CMYK inks through mogrify (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const source = retained ? { filesystem: fs, cwd: "/" } : files;
        const prepared = await runMagickCli(["xc:red", "xc:lime", "xc:blue", "+append", "input.png"], source);
        expect(prepared.exitCode, prepared.stderr).toBe(0);
        const result = await runMogrifyCli(["-colorspace", "CMYK", "-kmeans", "1", "-format", "cmyk", "-depth", "8", "input.png"], source);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/input.cmyk") : files.get("input.cmyk")!;
        expect(Buffer.from(output).toString("hex")).toBe("aaaaaa00aaaaaa00aaaaaa00");
    });
}
