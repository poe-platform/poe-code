import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: each CMYK tuple repeats across both output rows.
const expected = "002bea0f002bea0fc68e006fc68e006f002bea0f002bea0fc68e006fc68e006f";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["-sample", "-scale"])(`preserves every CMYK channel when doubling dimensions with %s (${mode})`, async option => {
        const argv = ["xc:#f0c814", "xc:#204090", "+append", "-colorspace", "CMYK", option, "200%", "-depth", "8", "cmyk:-"];
        const filesystem = new MemoryFileSystem();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const args = createCommandArguments(argv);
        if (mode === "command") {
            const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            stderr = result.stderr;
            chunks.push(result.stdoutBytes!);
        }
        expect(stderr).toBe("");
        expect(Buffer.concat(chunks).toString("hex")).toBe(expected);
    });
}
