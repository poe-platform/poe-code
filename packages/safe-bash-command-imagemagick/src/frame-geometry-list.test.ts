import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: later images see earlier framed images.
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    for (const grouped of [false, true]) {
        it.each([
            { geometry: "%[fx:u[0].w]x2", expected: "9x6|9x6+0+0;23x5|23x5+0+0;" },
            { geometry: "%[fx:u[1].w]x2", expected: "13x6|13x6+0+0;15x5|15x5+0+0;" },
            { geometry: "%[fx:t+2]x2", expected: "7x6|7x6+0+0;11x5|11x5+0+0;" },
            { geometry: "%[fx:n+2]x2", expected: "11x6|11x6+0+0;13x5|13x5+0+0;" },
            { geometry: "%[fx:w]x%[fx:h]", expected: "9x6|9x6+0+0;15x3|15x3+0+0;" },
            { geometry: "4x3", expected: "11x8|11x8+0+0;13x7|13x7+0+0;" },
        ])(`${mode}, grouped=${grouped}: expands frame $geometry against the current list`, async ({ geometry, expected }) => {
            const input = Uint8Array.from({ length: 18 }, (_, i) => i + 1);
            const files = new Map([["/in.rgb", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.rgb", input);
            const argv = [...(grouped ? ["-size", "1x1", "xc:blue", "("] : []),
                "-size", "3x2", "-depth", "8", "rgb:/in.rgb", "-size", "5x1", "xc:red", "-frame", geometry,
                ...(grouped ? [")", "-delete", "0"] : []), "-format", "%wx%h|%g;", "info:/out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
