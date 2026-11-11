import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects offset-only raw extraction before output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const coder of ["gray", "rgb"] as const) {
        it.each([
            { before: ["-extract", "+1+0"], after: [], error: true },
            { before: ["-extract", "-1-1"], after: [], error: true },
            { before: [], after: [], error: false },
            { before: ["-extract", "+1+0", "+extract"], after: [], error: false },
            { before: [], after: ["-extract", "+1+0"], error: false },
            { before: ["-extract", "3x2+0+0"], after: [], error: false },
        ])(`${mode} ${coder}: before=$before after=$after`, async ({ before, after, error }) => {
            const input = Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(value => coder === "rgb" ? [value, value, value] : [value]));
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.raw", input], ["/out.raw", keep]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
            const argv = ["-size", "3x2", "-depth", "8", ...before, `${coder}:/in.raw`, ...after,
                "-format", "%wx%h|%g", "-write", "info:", "-depth", "8", `${coder}:/out.raw`];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect("stdout" in result ? result.stdout : stdout).toBe(error ? "" : "3x2|3x2+0+0");
            expect("stderr" in result ? result.stderr : stderr).toBe(error ? `magick: must specify image size for ${coder.toUpperCase()} input\n` : "");
            expect(result.exitCode).toBe(error ? 1 : 0);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw");
            expect(output).toEqual(error ? keep : input);
        });
    }
}
