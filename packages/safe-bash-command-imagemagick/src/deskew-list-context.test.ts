import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const header = new TextEncoder().encode("P6\n32 16\n255\n");
const input = new Uint8Array(header.length + 32 * 16 * 3);
input.set(header);
for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
    const stripe = ((y - Math.floor(x / 8)) % 7 + 7) % 7;
    input.set(stripe < 2 ? [12, 32, 74] : [237, 249, 218], header.length + (y * 32 + x) * 3);
}
const low = "35x21|-5.3558250428551908\n";
const high = "35x20|3.5763343749973515\n";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["%[fx:n*49]%", high + high],
        ["%[fx:(t+1)*49]%", low + high],
        ["%[fx:u[1].w*3]%", high + high],
        ["49%", low + low],
        ["96%", high + high],
        ["98%", high + high],
    ])(`evaluates deskew threshold %s with the full list and current index (${mode})`, async (threshold, expected) => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "+clone", "-deskew", threshold, "-format", "%wx%h|%[deskew:angle]\n", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
