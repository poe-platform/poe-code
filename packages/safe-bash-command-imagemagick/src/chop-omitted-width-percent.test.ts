import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["x25%", 0, true],
        ["x50%", 0, true],
        ["0x25%", 12, false],
        ["0x50%", 24, false],
        ["x1", 12, false],
    ] as const)(`distinguishes omitted percentage chop width: %s (${mode})`, async (geometry, removedBytes, warns) => {
        const pixels = Uint8Array.from({ length: 36 }, (_, i) => (i * 53 + 9) % 256);
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...pixels]);
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["in.ppm", input], ["out", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out", sentinel);
        const args = ["in.ppm", "-chop", geometry, "-depth", "8", "rgb:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(output).toEqual(pixels.slice(removedBytes));
    });
}
