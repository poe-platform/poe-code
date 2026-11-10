import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: omitted chop dimensions inherit the virtual page.
const original = Array.from({ length: 24 }, (_, i) => i + 1);
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["info", "rgb"] as const) {
        it.each([
            ["10x8+0+0", "Center", "+1+1", "6x4|10x8+0+0", original, true],
            ["3x2+0+0", "NorthWest", "+1+1", "3x2|2x1+0+0", [1, 5, 6, 19, 23, 24], false],
            ["3x2+0+0", "NorthWest", "2", "4x2|2x1+0+0", [15, 16, 17, 18, 21, 22, 23, 24], false],
            ["3x2+0+0", "NorthWest", "2x+1+1", "4x2|2x1+0+0", [1, 4, 5, 6, 19, 22, 23, 24], false],
            ["3x2+0+0", "NorthWest", "3x2+1+1", "3x2|2x1+0+0", [1, 5, 6, 19, 23, 24], false],
            ["3x2+0+0", "NorthWest", "2x2+1+1", "4x2|2x1+0+0", [1, 4, 5, 6, 19, 22, 23, 24], false],
            ["", "Center", "+1+1", "1x1|1x1+0+0", [1], false],
            ["", "NorthWest", "2x+1+1", "4x1|4x1+0+0", [1, 4, 5, 6], false],
        ] as const)(`chops page '%s' with %s gravity and %s (${format}, ${mode})`, async (page, gravity, geometry, metadata, values, warns) => {
            const input = Uint8Array.from(original.flatMap(value => [value, 50, 123]));
            const files = new Map([["/in.rgb", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.rgb", input);
            const args = ["-size", "6x4", "-depth", "8", "rgb:/in.rgb", ...(page ? ["-repage", page] : []),
                "-gravity", gravity, "-chop", geometry, "-format", "%wx%h|%g", `${format}:/out`];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(metadata);
            else expect(output).toEqual(Uint8Array.from(values.flatMap(value => [value, 50, 123])));
            expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
        });
    }
}
