import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const font = new Uint8Array(readFileSync(new URL("./fixtures/DejaVuSans.ttf", import.meta.url)));
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
