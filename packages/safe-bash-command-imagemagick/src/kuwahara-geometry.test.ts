import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["0b10", "0o10", "2x0b1", "2x1"])(`${mode}: validates Kuwahara geometry %s before replacing output`, async geometry => {
        const pixels = Uint8Array.from({ length: 8 * 8 * 3 }, (_, i) => (i * 47 + 19) % 256);
        const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "-kuwahara", geometry, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        if (geometry === "2x1") {
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([8, 8]);
        } else {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("invalid argument for option '-kuwahara'");
            expect(stderr).toContain(geometry);
            expect(output).toEqual(keep);
        }
    });
}
