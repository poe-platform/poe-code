import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35: six RGB pixels -> in.dib, independently decoded to RGB.
const dib = Buffer.from("KAAAAAMAAAACAAAAAQAYAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAADu/3cRmYRTJAAAAAAA/wD/AP8AAAAAAA==", "base64");
const rgb = Buffer.from("ff000000ff000000ffffee00991177245384", "hex");

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const truncated of [false, true]) {
        it(`${truncated ? "rejects truncated" : "reads external"} standalone DIB (${mode})`, async () => {
            const input = truncated ? dib.subarray(0, dib.length - 1) : dib;
            const files = new Map<string, Uint8Array>([["/in.dib", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.dib", input);
            const args = ["/in.dib", "/verify.png"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(truncated ? 1 : 0);
            if (truncated) {
                expect(files.has("/verify.png")).toBe(false);
                expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["in.dib"]);
            } else {
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/verify.png") : files.get("/verify.png")!;
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([3, 2]);
                expect(decoded.data.filter((_, index) => index % 4 !== 3)).toEqual(new Uint8Array(rgb));
            }
        });
    }
}
