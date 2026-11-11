import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-scale", "-resize", "-thumbnail"]) {
        for (const grouped of [false, true]) {
            it.each([
                { geometry: "%[fx:t+2]x2!", expected: "2x2;3x2;" },
                { geometry: "%[fx:n+2]x2!", expected: "4x2;4x2;" },
                { geometry: "%[fx:u[1].w]x2!", expected: "5x2;5x2;" },
                { geometry: "%[fx:u[0].w+1]x2!", expected: "9x2;10x2;" },
                { geometry: "%[fx:w]x2!", expected: "8x2;5x2;" },
                { geometry: "4x2!", expected: "4x2;4x2;" },
            ])(`${mode} ${operation}, grouped=${grouped}: resolves $geometry against the current list`, async ({ geometry, expected }) => {
                const input = Uint8Array.from({ length: 48 * 3 }, (_, i) => Math.floor(i / 3) + 1);
                const files = new Map([["/in.rgb", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.rgb", input);
                const argv = [...(grouped ? ["-size", "1x1", "xc:red", "("] : []),
                    "-size", "8x6", "-depth", "8", "rgb:/in.rgb", "-size", "5x2", "xc:blue", operation, geometry,
                    ...(grouped ? [")", "-delete", "0"] : []), "-format", "%wx%h;", "info:/out"];
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
}
