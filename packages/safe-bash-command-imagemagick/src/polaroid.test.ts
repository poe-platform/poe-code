import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, without a caption/font dependency.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        ...["", "NaN", "Infinity", "15oops"].map(angle => ({ angle, tail: ["png:out"], expected: "KEEP" })),
        { angle: undefined, tail: ["-format", "%wx%h %[channels]", "info:out"], expected: "16x12 srgb  3.0" },
        ...["0", "15", "-15"].map(angle => ({ angle, tail: ["-format", "%wx%h %[channels]", "info:out"], expected: `${angle === "0" ? "44x40" : "54x50"} srgba 4.0` })),
        ...[["0", "44x40+0-1"], ["15", "54x52-5-6"], ["-15", "54x52-5-6"], ["90", "40x44+0+0"], ["-90", "40x44-1-1"], ["180", "44x40-1+0"]].map(([angle, page]) => ({ angle, tail: ["-format", "%g", "info:out"], expected: page! })),
        ...[
            ["15", "0", "0", "00000000"],
            ["15", "10", "8", "dfdfdfff"],
            ["15", "22", "20", "ff0000ff"],
            ["0", "39", "32", "ffffff63"],
        ].map(([angle, x, y, hex]) => ({ angle, tail: ["+repage", "-crop", `1x1+${x}+${y}`, "+repage", "-depth", "8", "rgba:out"], expected: Buffer.from(hex!, "hex") })),
    ])(`${mode}: renders polaroid $angle $tail`, async ({ angle, tail, expected }) => {
        const argv = ["-seed", "7", "-size", "16x12", "xc:red", ...(angle === undefined ? [] : ["-polaroid", angle]), ...tail];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(expected === "KEEP" ? 1 : 0);
        const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(typeof expected === "string" ? new TextDecoder().decode(output) : Buffer.from(output)).toEqual(expected);
    });
}

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { page: true, angle: "0", expected: "36x34,36x34+32+9" },
        { page: true, angle: "12", expected: "44x42,44x42+28+5" },
        { page: false, angle: "0", expected: "36x34,36x34+0-1" },
        { page: false, angle: "12", expected: "44x42,44x42-4-5" },
        { page: true, angle: "0", expected: "12837268ce85c50a91e9291a775d00e3874aaaa77955b2131686872151adeed4", pixels: true },
    ])(`${mode}: preserves polaroid placement (page=$page, angle=$angle, pixels=$pixels)`, async ({ page, angle, expected, pixels }) => {
        const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Buffer.from(Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256))]);
        const files = new Map([["im.ppm", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = ["-seed", "7", "im.ppm", ...(page ? ["-repage", "15x17-2+3"] : []), "-polaroid", angle,
            ...(pixels ? ["-depth", "8", "rgba:out"] : ["-format", "%wx%h,%Wx%H%X%Y", "info:out"])];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr || ("stderr" in result ? String(result.stderr) : "")).toBe(0);
        const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        if (pixels) expect(output.byteLength).toBe(4896);
        expect(pixels ? createHash("sha256").update(output).digest("hex") : new TextDecoder().decode(output)).toBe(expected);
    });
}
