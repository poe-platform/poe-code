import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...Array.from({ length: 18 }, (_, i) => i + 10)]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["0x0+1+0", "2x2:3x2+1+0;", [1, 2, 4, 5]],
        ["0x1+1+0", "2x1:3x2+1+0;", [1, 2]],
        ["1x0+1+0", "1x2:3x2+1+0;", [1, 4]],
        ["x1+1+0", "2x1:3x2+1+0;", [1, 2]],
        ["1x+1+0", "1x2:3x2+1+0;", [1, 4]],
    ] as const)(`uses full axes for zero or omitted crop dimensions (${mode}): %s`, async (geometry, metadata, indices) => {
        for (const output of ["info", "rgb"] as const) {
            const args = ["/in.ppm", "-crop", geometry,
                ...(output === "info" ? ["-format", "%wx%h:%g;", "info:"] : ["-depth", "8", "rgb:/out.rgb"])];
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (output === "info") expect("stdout" in result ? result.stdout : stdout).toBe(metadata);
            else expect(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb"))
                .toEqual(Uint8Array.from(indices.flatMap(index => [10 + index * 3, 11 + index * 3, 12 + index * 3])));
        }
    });
}
