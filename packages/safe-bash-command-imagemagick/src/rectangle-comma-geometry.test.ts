import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI dimensions, canvas, and offsets.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const geometry of ["1x2", "1x2,3", "1x2,"]) {
        it.each([
            ["-shave", "7x3 9,5,+2,+1"],
            ["-border", "11x11 13,13,+2,+1"],
            ["-frame", "11x11 13,13,+2,+1"],
        ])(`preserves rectangle dimensions for %s ${geometry} (${mode})`, async (operation, expected) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", keep);
            const args = ["-size", "9x7", "xc:red", "-repage", "11x9+2+1", operation, geometry, "-format", "%wx%h %W,%H,%X,%Y", "info:/out"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
