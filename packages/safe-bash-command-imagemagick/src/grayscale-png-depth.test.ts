import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: PNG IHDR depth/type and decoded RGB8 hash.
const cases = [
    { options: [], depth: 8, color: 3, hash: "725b4d3ce22fd4489ffc2ad990616d447c67b37c20788c8cab5badc3982e807b" },
    ...[
        ["-type", "Grayscale"],
        ["-type", "GrayscaleAlpha"],
        ["-colorspace", "Gray"],
        ["-grayscale", "Rec709Luma"],
        ["-type", "Grayscale", "-depth", "8"],
        ["-depth", "16", "-type", "Grayscale"],
    ].map(options => ({ options, depth: options.includes("16") ? 16 : 8, color: 0,
        hash: "b5a7b5caba983420939f5162aaba6a5a90da91706bf741d11f142bdfbdbfd313" })),
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`preserves source depth for $options (${mode})`, async ({ options, depth, color, hash }) => {
        const source = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Buffer.from(Array.from({ length: 144 }, (_, i) => (i * 67 + 19) % 256))]);
        const files = new Map([["/in.ppm", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", source);
        const args = ["/in.ppm", ...options, "png:-"];
        const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr.push(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Array.from(bytes.slice(24, 26))).toEqual([depth, color]);
        const decoded = decodeImage(bytes);
        expect([decoded.width, decoded.height]).toEqual([8, 6]);
        const pixels = decoded.data16 ? Uint8Array.from(decoded.data16, value => Math.round(value / 257)) : decoded.data;
        const rgb = pixels.filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(hash);
    });
}
