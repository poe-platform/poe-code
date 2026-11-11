import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n32 16\n255\n"), Uint8Array.from({ length: 32 * 16 * 3 }, (_, i) => {
    const pixel = Math.floor(i / 3), x = pixel % 32, y = Math.floor(pixel / 32);
    return (x >= 3 && x < 29 && [3, 4, 8, 9].includes(y - Math.floor(x / 7)) ? [10, 30, 60] : [240, 247, 252])[i % 3]!;
})]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default", options: [], pixel: [255, 255, 255], hash: "dd640e628393f0331549b1d6da16a19469316f822b32ad4ff14df79955af8f1c" },
        { name: "explicit", options: ["-background", "lime"], pixel: [0, 255, 0], hash: "bb80471f49e96c39f90b142a5465fd35c9d045044666bbd6da4630ae6b532fe5" },
        { name: "image property", options: ["-set", "background", "lime"], pixel: [0, 255, 0], hash: "bb80471f49e96c39f90b142a5465fd35c9d045044666bbd6da4630ae6b532fe5" },
        { name: "option property", options: ["-set", "option:background", "lime"], pixel: [0, 255, 0], hash: "bb80471f49e96c39f90b142a5465fd35c9d045044666bbd6da4630ae6b532fe5" }
    ])(`${mode}: deskew uses $name background`, async ({ options, pixel, hash }) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-deskew", "40%", "-depth", "8", "-write", "rgb:/pixels",
            "-format", "%wx%h %g %[deskew:angle]", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("35x21 35x21-1-4 -5.3558250428551908");
        const output = mode === "buffered" || mode === "sync" ? files.get("/pixels")! : await fs.readFile("/pixels");
        expect(output.length).toBe(2205);
        expect([...output.subarray(0, 3)]).toEqual(pixel);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
