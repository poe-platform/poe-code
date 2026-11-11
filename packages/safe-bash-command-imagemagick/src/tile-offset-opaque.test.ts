import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { offset: "+1+1", reset: false, pixels: [7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 1, 2, 3, 4, 5], hash: "010354d8042070e832553ddd1d586095fbc9cce7afd1b94b7de49086422e6d6f" },
        { offset: "+2+1", reset: false, pixels: [8, 9, 10, 11, 6, 14, 15, 16, 17, 12, 20, 21, 22, 23, 18, 2, 3, 4, 5, 0], hash: "786121b0247cf60bc49e8a42e8a8c522ec30694571c04823382558bb27fc0d3f" },
        { offset: "+0+0", reset: false, pixels: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22], hash: "6cc30b303b516451cb09a5b0bbe1f6ef8a489a979aa8a1830b65d14a619753c3" },
        { offset: "-1-1", reset: false, pixels: [23, 18, 19, 20, 21, 5, 0, 1, 2, 3, 11, 6, 7, 8, 9, 17, 12, 13, 14, 15] },
        { offset: "+8+5", reset: false, pixels: [8, 9, 10, 11, 6, 14, 15, 16, 17, 12, 20, 21, 22, 23, 18, 2, 3, 4, 5, 0] },
        { offset: "-7-5", reset: false, pixels: [23, 18, 19, 20, 21, 5, 0, 1, 2, 3, 11, 6, 7, 8, 9, 17, 12, 13, 14, 15] },
        { offset: "+2+1", reset: true, pixels: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22] },
    ])(`${mode}: wraps opaque PPM offset $offset, reset=$reset`, async ({ offset, reset, pixels, hash }) => {
        const ppm = Buffer.concat([Buffer.from("P6\n6 4\n255\n"), Uint8Array.from({ length: 72 }, (_, i) => i)]);
        const files = new Map([["/in.ppm", ppm]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm);
        const argv = ["-tile-offset", offset, ...(reset ? ["+tile-offset"] : []), "-size", "5x4", "tile:/in.ppm", "-depth", "8", "rgb:-"];
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect([...bytes]).toEqual(pixels.flatMap(pixel => [pixel * 3, pixel * 3 + 1, pixel * 3 + 2]));
        // Native ImageMagick 7.1.2-35 Q16-HDRI output for the reported cases.
        if (hash) expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
