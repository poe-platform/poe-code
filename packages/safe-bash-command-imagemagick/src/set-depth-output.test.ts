import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI writes 16-bit samples for all three depth forms.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["ppm", "miff"] as const) {
        it.each([
            { options: [], depth: 8 },
            { options: ["-depth", "16"], depth: 16 },
            { options: ["-set", "depth", "16"], depth: 16 },
            { options: ["-set", "option:depth", "16"], depth: 16 },
        ])(`encodes requested ${format} depth in files and stdout (${mode}): $options`, async ({ options, depth }) => {
            const pixels = Uint8Array.from({ length: 144 }, (_, index) => (index * 67 + 19) % 256);
            const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), pixels]);
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["/in.ppm", ...options, "-write", `${format}:/mid`, `${format}:-`];
            const argumentValues = createCommandArguments(args);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
            const saved = mode === "command" || mode === "retained"
                ? await filesystem.readFile("/mid") : files.get("/mid")!;
            for (const bytes of [saved, stdout]) {
                const headerEnd = format === "miff" ? bytes.indexOf(26) + 1
                    : bytes.indexOf(10, bytes.indexOf(10, bytes.indexOf(10) + 1) + 1) + 1;
                const header = new TextDecoder().decode(bytes.subarray(0, headerEnd));
                expect(header).toContain(format === "miff" ? `depth=${depth}\n` : `\n${depth === 16 ? 65535 : 255}\n`);
                const expected = depth === 16 ? Uint8Array.from([...pixels].flatMap(value => [value, value])) : pixels;
                expect(Buffer.from(bytes.subarray(headerEnd))).toEqual(Buffer.from(expected));
                const decoded = decodeImage(bytes);
                expect([decoded.width, decoded.height]).toEqual([8, 6]);
                expect(decoded.data).toEqual(Uint8Array.from([...pixels].flatMap((value, index) => index % 3 === 2 ? [value, 255] : [value])));
            }
        });
    }
}
