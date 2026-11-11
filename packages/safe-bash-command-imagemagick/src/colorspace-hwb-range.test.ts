import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: out-of-range sectors use the red/green
// arrangement, but retain the fractional hue and the sector's parity.
for (const alpha of ["ff", "80"]) {
    it.each([
        ["-110%", "d09030"], ["-100%", "d03030"], ["-25%", "d08030"],
        ["-10%", "d09030"], ["0%", "d03030"], ["25%", "80d030"],
        ["100%", "d03030"], ["110%", "d09030"], ["125%", "d08030"],
        ["150%", "d0d030"], ["175%", "d08030"], ["200%", "d03030"],
    ])(`converts HWB hue %s to native sRGB with alpha ${alpha}`, async (hue, rgb) => {
        const fs = new MemoryFileSystem();
        const args = createCommandArguments([`xc:#d03060${alpha}`, "-colorspace", "HWB", "-channel", "R",
            "-evaluate", "set", hue, "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:-"]);
        const output: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { output.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.concat(output).toString("hex")).toBe(rgb + alpha);
    });
}

it.each([
    { sampling: [], hash: "42178926612c8df931c986ccb2736aa769505c4ea98be25afb48dd77e2cebd26" },
    { sampling: ["-filter", "Point", "-interpolate", "nearest"], hash: "b911166a3299002aa2b590120842bc3d1d45ba424d0fa3abbffd33dede8defae" },
])("preserves native HWB deskew pixels with sampling $sampling", async ({ sampling, hash }) => {
    const pixels = new Uint8Array(32 * 16 * 3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
        pixels.set((y - Math.floor(x / 8) + 7) % 7 < 2 ? [12, 32, 74] : [237, 249, 218], (y * 32 + x) * 3);
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", Buffer.concat([Buffer.from("P6\n32 16\n255\n"), pixels]));
    const args = createCommandArguments(["/in.ppm", "-colorspace", "HWB", ...sampling,
        "-deskew", "40%", "-colorspace", "sRGB", "-depth", "8", "rgba:-"]);
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const bytes = Buffer.concat(output);
    expect(bytes.length).toBe(2800);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
});
