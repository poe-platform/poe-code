import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["80,0+1+2", "3x2 4x4+1+2 srgba 4.0;"],
        ["80/0+1+2", "3x2 4x4+1+2 srgba 4.0;"],
        ["80:2+1+2", "7x6 6x6-1+0 srgba 4.0;"],
        ["80x0+1+2,3", "3x2 4x4+1+2 srgba 4.0;"],
        ["80x0+1+2", "3x2 4x4+1+2 srgba 4.0;"],
        ["40x1+1+2", "7x6 6x6-1+0 srgba 4.0;"],
    ])(`matches native shadow geometry %s (${mode})`, async (geometry, expected) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const argv = ["-size", "3x2", "xc:#5080c080", "-background", "#d04020", "-shadow", geometry!, "-format", "%wx%h %g %[channels];", "info:/out"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
