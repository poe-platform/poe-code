import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompositeCli, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references and alpha/clamping boundaries; 16-bit big-endian RGBA.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "direct composition", input: ["xc:#b02050", "xc:#3090c0"], operation: ["-composite"], hex: "11114141d1d1ffff" },
        { name: "colored background", input: ["-background", "#b02050", "xc:#3090c0"], operation: ["-layers", "flatten"], hex: "11114141d1d1ffff" },
        { name: "translucent stack", input: ["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482"], operation: ["-layers", "merge"], hex: "530e4bf2ab04d126" },
        { name: "transparent source", input: ["xc:#b0205080", "xc:#3090c000"], operation: ["-composite"], hex: "b0b0202050508080" },
        { name: "transparent destination", input: ["xc:#b0205000", "xc:#3090c080"], operation: ["-composite"], hex: "30309090c0c08080" },
        { name: "transparent operands", input: ["xc:#b0205000", "xc:#3090c000"], operation: ["-composite"], hex: "0000000000000000" },
        { name: "clipped channels", input: ["xc:#103080", "xc:#00ffff"], operation: ["-composite"], hex: "0000ffffffffffff" },
        { name: "Over control", input: ["xc:#b02050", "xc:#3090c0"], compose: "Over", operation: ["-composite"], hex: "30309090c0c0ffff" }
    ])(`${mode}: LinearLight $name`, async ({ input, compose = "LinearLight", operation, hex }) => {
        const argv = [...input, "-compose", compose, ...operation, "-depth", "16", "-endian", "MSB", "rgba:-"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}

for (const retained of [false, true]) {
    it(`composite command applies LinearLight, retained=${retained}`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        for (const [path, pixels] of [
            ["/overlay.png", [48, 144, 192, 255]],
            ["/base.png", [176, 32, 80, 255]]
        ] as const) {
            const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            files.set(path, bytes);
            await filesystem.writeFile(path, bytes);
        }
        const result = await runCompositeCli([
            "-compose", "LinearLight", "/overlay.png", "/base.png", "/out.png"
        ], retained ? { filesystem, cwd: "/" } : files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data]).toEqual([17, 65, 209, 255]);
    });
}
