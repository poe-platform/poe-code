import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([true, false])(`requires an input before chop (beforeInput=%s, ${mode})`, async (beforeInput) => {
        const pixels = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 4 === 0 ? Math.floor(i / 4) + 1 : 0);
        const input = await sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/input.png", input], ["/output.png", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/output.png", keep);
        const args = [...(beforeInput ? ["-chop", "2x1+2+1", "/input.png"] : ["/input.png", "-chop", "2x1+2+1"]), "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect(result.exitCode).toBe(beforeInput ? 1 : 0);
        if (beforeInput) {
            expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-chop'");
            expect(output).toEqual(keep);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([5, 4]);
            expect(decoded.data).toEqual(Uint8Array.from(
                [1, 2, 5, 6, 7, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30, 33, 34, 35]
                    .flatMap(value => [value, 0, 0, 255]),
            ));
        }
    });
}
