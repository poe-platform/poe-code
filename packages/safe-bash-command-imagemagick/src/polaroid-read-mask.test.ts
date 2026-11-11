import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 12x8 PPM with sample (i * 13 + 7) % 256.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "no mask", before: [], after: [], mean: "0.896682", channels: 4 },
        { name: "one-pixel white mask", before: ["-read-mask", "xc:white"], after: [], mean: "0", channels: 5 },
        { name: "full-size white mask", before: ["-size", "12x8", "-read-mask", "xc:white"], after: [], mean: "0", channels: 5 },
        { name: "black mask", before: ["-read-mask", "xc:black"], after: [], mean: "0", channels: 5 },
        { name: "removed one-pixel mask", before: ["-read-mask", "xc:white"], after: ["+read-mask"], mean: "0.896682", channels: 4 },
        { name: "removed full-size mask", before: ["-size", "12x8", "-read-mask", "xc:white"], after: ["+read-mask"], mean: "0.896682", channels: 4 },
    ])(`${mode}: matches polaroid statistics with $name`, async ({ before, after, mean, channels }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 13 + 7) % 256)]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...before, "-polaroid", "0", ...after, "-format", "%[fx:mean.r]|%[channels]|%wx%h", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect("stdout" in result ? result.stdout : stdout).toBe(`${mean}|srgba ${channels}.0|40x36`);
    });
}
