import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const opaque = ["xc:#804020"];
const transparent = ["xc:#80402080", "xc:#98483340", "xc:#80402080", "xc:#00408000", "xc:#99330000", "+append"];
const properties = ["-format", "%[colorspace]|%[channels]|%[fx:u.r]"];
const count = ["-format", "%wx%h/%k"];

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs, including unchanged CMYK controls.
for (const mode of ["public", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "sRGB palette", input: opaque, operations: ["+dither", "-colors", "3", ...properties], output: "info:/out", expected: Buffer.from("sRGB|srgb  4.0|0.501961") },
        { name: "discarded black channel", input: opaque, operations: ["+dither", "-colors", "3", "-channel", "K", "-separate", "+channel", "-depth", "8"], output: "gray:/out", expected: Buffer.from([0]) },
        { name: "three distinct colors", input: transparent, operations: ["+dither", "-colors", "3", ...count], output: "info:/out", expected: Buffer.from("5x1/3") },
        { name: "unchanged colorspace", input: opaque, operations: properties, output: "info:/out", expected: Buffer.from("CMYK|cmyk  4.0|0") },
        { name: "unique colors control", input: transparent, operations: ["-unique-colors", ...count], output: "info:/out", expected: Buffer.from("4x1/4") },
        { name: "unchanged color count", input: transparent, operations: count, output: "info:/out", expected: Buffer.from("5x1/4") },
    ])(`$name (${mode})`, async ({ input, operations, output, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...input, "-colorspace", "CMYK", ...operations, output];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(bytes)).toEqual(expected);
    });
}
