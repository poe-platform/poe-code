import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["80x0x2+1+2", "11x10 8x8-3-2 0.000583118"],
        ["80x0X2+1+2", "11x10 8x8-3-2 0.000583118"],
        ["80x2+1+2", "11x10 8x8-3-2 0.000583118"],
    ])(`matches native hexadecimal shadow sigma %s (${mode})`, async (geometry, expected) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const argv = ["-size", "3x2", "xc:#507ba080", "-background", "#d05028", "-shadow", geometry!, "-format", "%wx%h %g %[fx:p{0,0}.a]", "info:/out"];
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
