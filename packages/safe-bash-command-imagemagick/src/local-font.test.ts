import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const font = new Uint8Array(readFileSync(new URL("./fixtures/DejaVuSans.ttf", import.meta.url)));
const serif = new Uint8Array(readFileSync(new URL("./fixtures/DejaVuSerif.ttf", import.meta.url)));
const ppm = new Uint8Array([...new TextEncoder().encode("P6\n8 6\n255\n"), ...Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256)]);
// ImageMagick 7.1.2-35 Q16-HDRI, DejaVu Sans 2.37.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { settings: [], expected: "8x6,8x6+0+0" },
        { settings: ["-pointsize", "10"], expected: "8x6,8x6+0+0" },
        { settings: ["-font", "font.ttf"], expected: "8x6,8x6+0+0" },
        { settings: ["-font", "missing.ttf"], expected: "8x6,8x6+0+0" },
        { settings: ["-font", "font.ttf", "+font"], expected: "8x6,8x6+0+0" },
        { settings: ["-font"], expected: "KEEP", error: "missing argument" },
        { settings: ["-font", "missing.ttf", "-set", "caption", "Hi", "-polaroid", "0"], expected: "KEEP", error: "unable to read font" },
        { settings: ["-font", "im.ppm", "-set", "caption", "Hi", "-polaroid", "0"], expected: "KEEP", error: "unable to read font" },
        { settings: ["-font", "font.ttf", "-pointsize", "10", "-set", "caption", "Hi", "-polaroid", "0"], expected: "36x47,36x47+0-1" },
        { settings: ["-font", "font.ttf", "-pointsize", "10", "-set", "caption", "Hi", "-polaroid", "0", "-depth", "8"], expected: "335ab18564cef157aaf3041d618ab863661282bfd0d215da7c437b7ca53b49aa", rgba: true },
    ])(`${mode}: local font $settings`, async ({ settings, expected, rgba, error }) => {
        const argv = ["-seed", "7", "im.ppm", ...settings, ...(settings.at(-1) === "-font" ? ["info:out"] : rgba ? ["rgba:out"] : ["-format", "%wx%h,%Wx%H%X%Y", "info:out"])];
        const files = new Map([["im.ppm", ppm], ["font.ttf", font], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work");
        for (const [path, bytes] of files) await fs.writeFile("/work/" + path, bytes);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/work", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        const diagnostic = stderr || ("stderr" in result ? String(result.stderr) : "");
        expect(result.exitCode, diagnostic).toBe(error ? 1 : 0);
        if (error) expect(diagnostic).toContain(error);
        const output = mode === "command" ? await fs.readFile("/work/out") : files.get("out")!;
        if (rgba) expect(output.length).toBe(6768);
        expect(rgba ? createHash("sha256").update(output).digest("hex") : new TextDecoder().decode(output)).toBe(expected);
    });
}

// Native ImageMagick 7.1.2-31 Q16-HDRI pixel hashes for the checked-in fonts.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each(["label", "caption"].flatMap(coder => [
        { coder, name: "DejaVu Sans", bytes: font, hash: "d28c49c500b440a87e4ed5670d49bb0f084797bded6a02e91ea0aca2a4e78009" },
        { coder, name: "DejaVu Serif", bytes: serif, hash: "52768efd2b41448081431ff5638679956c137529d569bd78d68bafc80216b186" },
        { coder, name: "invalid", bytes: ppm, hash: undefined },
        { coder, name: "missing", bytes: undefined, hash: undefined }
    ]))(`${mode}: $coder renders $name glyphs on the requested canvas`, async ({ coder, bytes, hash }) => {
        const argv = ["-font", "font.ttf", "-pointsize", "20", "-size", "140x50", `${coder}:Wing`, "-depth", "8", "rgb:out"];
        const files = new Map<string, Uint8Array>([["out", new TextEncoder().encode("KEEP")], ...(bytes ? [["font.ttf", bytes] as [string, Uint8Array]] : [])]);
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work");
        for (const [path, contents] of files) await fs.writeFile("/work/" + path, contents);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/work", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        const diagnostic = stderr || ("stderr" in result ? String(result.stderr) : "");
        expect(result.exitCode, diagnostic).toBe(hash ? 0 : 1);
        const output = mode === "command" ? await fs.readFile("/work/out") : files.get("out")!;
        if (hash) {
            expect(output.length).toBe(21000);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        } else {
            expect(diagnostic).toContain("unable to read font");
            expect(new TextDecoder().decode(output)).toBe("KEEP");
        }
    });
}
