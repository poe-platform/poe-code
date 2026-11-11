import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 rejects bare scalar dimensions with offsets, but accepts an x delimiter.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const option of ["-sample", "-resize", "-scale", "-thumbnail", "-adaptive-resize"]) {
        it.each([
            ["2+1+2", undefined], ["2+0", undefined], ["2-1-2", undefined], ["2e+0+1+2", undefined],
            ["2x+1+2", "2x1"], ["2X-1-2", "2x1"], ["2", "2x1"],
            ["2e+0", "2x1"], ["2e-0", "2x1"], ["+1+2", "7x5"],
        ] as const)(`validates ${option} %s (${mode})`, async (geometry, expected) => {
            const input = new TextEncoder().encode("P2\n7 5\n255\n" + Array.from({ length: 35 }, (_, i) => i + 1).join(" "));
            const files = new Map([["/in.pgm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pgm", input);
            const args = ["/in.pgm", option, geometry, "-format", "%wx%h", "info:"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(expected === undefined ? 1 : 0);
            expect("stdout" in result ? result.stdout : stdout).toBe(expected ?? "");
            if (expected === undefined) expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${option}'`);
            else expect("stderr" in result ? result.stderr : stderr).toBe("");
        });
    }
}
