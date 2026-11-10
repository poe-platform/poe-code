import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["(0x1+1+1)", "0x1+1+1#", "0x1+1+1@", "0x1+1+1,2", "0x1+1+1", "0x1+1+1!"])(
        `preserves vignette insets for %s (${mode})`, async geometry => {
            const sentinel = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", sentinel);
            const argv = ["-size", "6x4", "xc:#3876b4", "xc:#3876b4", "-background", "#d29153",
                "-vignette", geometry, "+append", "-depth", "8", "rgba:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(output).toHaveLength(12 * 4 * 4);
            // ImageMagick 7.1.2-35 Q16-HDRI: complete row-major RGBA8 output.
            expect(createHash("sha256").update(output).digest("hex"))
                .toBe("476030178dcacd8c56c219f32e0a51180983b832ed6e2a9e76d1bb17191e1ac3");
        }
    );
}
