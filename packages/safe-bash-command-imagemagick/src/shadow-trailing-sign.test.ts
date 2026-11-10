import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["80x0+1+", "80x0+1-", "80x0+1", "80x0+1+4"])(`preserves shadow sigma and offsets for %s (${mode})`, async geometry => {
        for (const format of ["info", "rgba"] as const) {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", original);
            const args = ["-size", "3x2", "xc:#5080c080", "-background", "#d04020", "-shadow", geometry,
                "-depth", "8", "-format", "%wx%h %g %[channels];", `${format}:/out`];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            // ImageMagick 7.1.2-35: omitted y defaults to four, including a bare final sign.
            if (format === "info") expect(new TextDecoder().decode(output)).toBe("3x2 4x6+1+4 srgba 4.0;");
            else expect(output).toEqual(Uint8Array.from({ length: 6 * 4 }, (_, i) => [208, 64, 32, 102][i % 4]!));
        }
    });
}
