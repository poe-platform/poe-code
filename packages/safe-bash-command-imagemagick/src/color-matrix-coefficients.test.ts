import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: text coefficients are zero; numeric suffixes
// and a trailing comma invalidate the kernel before the destination is written.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { matrix: "3x3:0 1 0 0 bogus 1 1 0 0", expected: [95, 163, 32, 128] },
        { matrix: "3x3:0 1 0 0 0 1 1 0 0", expected: [95, 163, 32, 128] },
        { matrix: "3x3:0 1 0 0 0.5 1 1 0 0", expected: [95, 211, 32, 128] },
        { matrix: "3x3:0,1,0,0,bogus,1,1,0,0", expected: [95, 163, 32, 128] },
        { matrix: "3x3:0 1 0 0 1foo 1 1 0 0", expected: undefined },
        { matrix: "3x3:0 1 0 0 0foo 1 1 0 0", expected: undefined },
        { matrix: "3x3:1 0 0 0 1 0 0 0 1,", expected: undefined },
        { matrix: "3x3:1 0 0 0 1 0 0 0 1, \n", expected: undefined },
    ])(`${mode}: validates color-matrix coefficients in $matrix`, async ({ matrix, expected }) => {
        const input = await sharp(new Uint8Array([32, 95, 163, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "-color-matrix", matrix, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (expected === undefined) {
            expect(result.exitCode).toBe(1);
            expect(diagnostic).toContain("Invalid color matrix");
            expect(output).toEqual(keep);
        } else {
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(output).data]).toEqual(expected);
        }
    });
}
