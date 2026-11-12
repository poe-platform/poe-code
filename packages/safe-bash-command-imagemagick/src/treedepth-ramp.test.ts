import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: opaque 5x3 RGB ramp, no dithering.
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => i))]);

for (const mode of ["public", "sync"] as const) {
    it.each([
        { name: "depth 2", options: ["-treedepth", "2", "-colors", "4"], expected: "060708".repeat(6) + "1d1e1f".repeat(9) },
        { name: "depth 3", options: ["-treedepth", "3", "-colors", "8"], expected: "08090a".repeat(5) + "141516".repeat(3) + "1a1b1c".repeat(2) + "1e1f20".repeat(2) + "262728".repeat(3) },
        { name: "depth 4", options: ["-treedepth", "4", "-colors", "8"], expected: "060708".repeat(5) + "151617".repeat(4) + "1e1f20".repeat(2) + "262728".repeat(4) },
        { name: "unreduced", options: [], expected: Buffer.from(Array.from({ length: 45 }, (_, i) => i)).toString("hex") },
    ])(`matches every native RGB byte at $name (${mode})`, async ({ options, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "+dither", ...options, "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : runConvertCliSync(args, files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "public" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
