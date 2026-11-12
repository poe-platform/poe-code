import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const header = new TextEncoder().encode("P6\n16 8\n255\n");
const input = new Uint8Array(header.length + 16 * 8 * 3);
input.set(header);
for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    input.set(y === 2 + Math.floor(x / 5) ? [100, 110, 130] : [230, 224, 218], header.length + (y * 16 + x) * 3);
}

for (const mode of ["buffered", "retained", "sync", "command"]) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI consumes the fraction only with a leading sign.
    it.each([
        ["+0x27.8%", true], ["39.5%", true], ["39%", false],
        ["0x27.8%", false], ["+0x27%", false],
        ["+0X27.80%", true], ["-0x27.8%", false],
        ["+0x27.8", false], ["+0x27.8 %", false],
        ["+0x27.8x2%", false], ["+0x27.8%x2", true]
    ] as const)(`${mode}: reads deskew hexadecimal threshold %s`, async (threshold, tilted) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-deskew", threshold, "-format", "%wx%h %g %[deskew:angle]", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(tilted ? "18x11 18x11-1-2 -3.5763343749973515" : "18x10 18x10-1-1 -0");
    });
}
