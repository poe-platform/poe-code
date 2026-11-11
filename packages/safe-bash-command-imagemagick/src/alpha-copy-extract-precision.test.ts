import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete big-endian output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "", copy: true, depth: "16", expected: "123f3966608d87b4aedbd602ea9b23504a77719e98c5bfece7130d3a3461" },
        { space: "HSL", copy: true, depth: "16", expected: "124b4285719a9be181bfc6d2e0c3264756218c248904a0ffdc0b0d233c82" },
        { space: "Lab", copy: true, depth: "16", expected: "837176aa68887e8599c6a742a8d37c01745b65ca8bf8a1afa7b985d77758" },
        { space: "HSL", copy: true, depth: "8", expected: "1242719b81c6e026568b89a0db0d3c" },
        { space: "Lab", copy: true, depth: "8", expected: "8376687e99a7a87c74658ba1a78577" },
        { space: "HSL", copy: false, depth: "16", expected: "ffff".repeat(15) },
        { space: "Lab", copy: false, depth: "16", expected: "a9aa".repeat(15) },
    ])(`${mode}: copy=$copy $space to $depth-bit gray`, async ({ space, copy, depth, expected }) => {
        const argv = ["/in.ppm", ...(copy ? ["-alpha", "copy"] : []), ...(space ? ["-colorspace", space] : []),
            "-alpha", "extract", "-depth", depth, "-endian", "MSB", "gray:-"];
        const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => (i * 13 + 7) % 256))]);
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
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
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
