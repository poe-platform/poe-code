import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, asymmetric 12x8 PPM.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { depth: "16", size: 11520, hash: "b6437537adc4bf79b2cd8db3b7de88f84c5fccae70c43100f02ad44e167c67b8" },
        { depth: "8", size: 5760, hash: "528bf55864c1e4ae2f9b9c95256fde30722ebc3d350e1ca895e67f7433129749" },
        { depth: undefined, geometry: "40x36 40x36+0-1" }
    ])(`${mode}: preserves zero-degree polaroid samples at depth $depth`, async ({ depth, size, hash, geometry }) => {
        const input = Buffer.concat([Buffer.from("P6\n12 8\n255\n"), Buffer.from(Array.from({ length: 288 }, (_, i) => (i * 13 + 7) % 256))]);
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-polaroid", "0", ...(depth ? ["-depth", depth, "-endian", "MSB", "rgba:-"] : ["-format", "%wx%h %g", "info:"])];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(data) { chunks.push(data.slice()); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(chunks);
        if (geometry) expect(output.toString()).toBe(geometry);
        else {
            expect(output.length).toBe(size);
            if (depth === "16") {
                expect(output.readUInt16BE(((11 * 40 + 22) * 4 + 2) * 2)).toBe(47403);
                expect(output.readUInt16BE(((13 * 40 + 22) * 4 + 2) * 2)).toBe(32804);
            }
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        }
    });
}
