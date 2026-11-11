import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const output of ["pixels", "page"] as const) {
        it.each([
            ["7x5+0-2", "2x1", "3x2:7x5+0-2;", true],
            ["7x5-1-2", "2x1", "3x2:7x5-1-2;", true],
            ["7x5-3+0", "2x1", "3x2:7x5-3+0;", true],
            ["7x5+0-2", "2x1+0+0", "3x2:7x5+0-2;", true],
            ["3x2+0+0", "2x1", "2x1:3x2+0+0;1x1:3x2+2+0;2x1:3x2+0+1;1x1:3x2+2+1;", false],
        ] as const)(`preserves boundary crop %s %s (${mode}, ${output})`, async (page, crop, metadata, warns) => {
            const pixels = Uint8Array.from({ length: 18 }, (_, i) => i + 10);
            const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), pixels]);
            const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["/in.ppm", "-repage", page, "-crop", crop,
                ...(output === "pixels" ? ["-depth", "8", "rgb:-"] : ["-format", "%wx%h:%g;", "info:"])];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? new TextDecoder().decode(result.stdoutBytes) : "stdout" in result ? result.stdout : stdout).toBe(output === "pixels" ? new TextDecoder().decode(pixels) : metadata);
            expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${crop}'\n` : "");
        });
    }
}
