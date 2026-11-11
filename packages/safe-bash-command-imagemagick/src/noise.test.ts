import { createHash } from "node:crypto";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -seed 7 -size 2x1 xc:#808080 ... -depth 8 rgba:-.
const cases = [
    { options: ["+noise", "Uniform"], expected: "80817fff828281ff" },
    { options: ["+noise", "Gaussian"], expected: "6b757eff90736aff" },
    { options: ["-evaluate", "Uniform-noise", "1"], expected: "80817fff828281ff" },
    { options: ["+noise", "uNiFoRm"], expected: "80817fff828281ff" },
    { options: ["+noise", "gAuSsIaN"], expected: "6b757eff90736aff" },
    { options: [], expected: "808080ff808080ff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: matches seeded RGB noise $options`, async ({ options, expected }) => {
        for (let repeat = 0; repeat < 2; repeat++) {
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = ["-seed", "7", "-size", "2x1", "xc:#808080", ...options, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out.rgba"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const stdout: Buffer[] = [];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        }
    });
}

// Native fixtures use MAGICK_THREAD_LIMIT=1 to keep the random stream serial.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { distribution: "Uniform", channels: [], expected: "285177812a51787e" },
        { distribution: "Uniform", channels: ["-channel", "R"], expected: "2850788029507880" },
        { distribution: "Uniform", channels: ["-channel", "A"], expected: "2850788028507880" },
        { distribution: "Gaussian", channels: [], expected: "134576901b3a5f8c" },
        { distribution: "Gaussian", channels: ["-channel", "R"], expected: "135078801d507880" },
        { distribution: "Gaussian", channels: ["-channel", "A"], expected: "2850786b28507874" },
    ])(`${mode}: honors $distribution channel selection $channels on translucent RGB`, async ({ distribution, channels, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-seed", "7", "-size", "2x1", "xc:rgba(40,80,120,0.5)", ...channels, "+noise", distribution, "-depth", "8", "rgba:/out.rgba"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });

    it.each([
        { distribution: "Uniform", depth: "16", size: "2x1", expected: "80b781527ff2ffff823e827981a3ffff" },
        { distribution: "Gaussian", depth: "16", size: "2x1", expected: "6b9875347e36ffff90c4734b6ac2ffff" },
        { distribution: "Uniform", depth: "8", size: "65x65", expected: "f2c3b5b92dc9dc4e9580fd3a1c57ab9f311171be07d46c8e321ebe0985cdd4a8" },
        { distribution: "Gaussian", depth: "8", size: "65x65", expected: "bb6dd609e11614fd4e4d3aeadd57ec4fadb6a637bb22b81941cd97ed2b44365a" },
    ])(`${mode}: preserves $distribution samples across $depth-bit $size images and resets for each image`, async ({ distribution, depth, size, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-seed", "7", "-size", size, "xc:#808080", "xc:#808080", "+noise", distribution, "-depth", depth, "-endian", "MSB", "rgba:/out-%d.rgba"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const path of ["/out-0.rgba", "/out-1.rgba"]) {
            const bytes = mode === "retained" ? await fs.readFile(path) : files.get(path)!;
            expect(depth === "16" ? Buffer.from(bytes).toString("hex") : createHash("sha256").update(bytes).digest("hex")).toBe(expected);
        }
    });

    it(`${mode}: rejects invalid distributions before replacing output`, async () => {
        const original = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem(), files = new Map([["/out.rgba", original]]);
        await fs.writeFile("/out.rgba", original);
        const argv = ["xc:red", "+noise", "Invalid", "rgba:/out.rgba"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")).toEqual(original);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases.slice(0, 2))(`${mode}: applies $options in mogrify`, async ({ options, expected }) => {
        const input = await sharp(Buffer.from("808080808080", "hex"), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await fs.writeFile("/in.png", input);
        const argv = ["-seed", "7", ...options, "/in.png"];
        const result = mode === "sync" ? runMogrifyCliSync(argv, files)
            : await runMogrifyCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" ? await fs.readFile("/in.png") : files.get("/in.png")!;
        expect(Buffer.from(decodeImage(bytes).data).toString("hex")).toBe(expected);
    });
}
