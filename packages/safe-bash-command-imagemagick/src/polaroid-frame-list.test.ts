import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI frame-list expressions and literal controls.

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const grouped of [false, true]) {
        it.each([
            { angle: "%[fx:n*6]", expected: "44x42;44x42;" },
            { angle: "%[fx:t*12]", expected: "36x34;44x42;" },
            { angle: "0", expected: "36x34;36x34;" },
            { angle: "12", expected: "44x42;44x42;" },
        ])(`${mode}, grouped=${grouped}: evaluates polaroid $angle against the frame list`, async ({ angle, expected }) => {
            const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Buffer.from(Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256))]);
            const files = new Map([["im.ppm", input], ["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
            const argv = ["-seed", "7", ...(grouped ? ["("] : []), "im.ppm", "im.ppm", "-polaroid", angle, ...(grouped ? [")"] : []), "-format", "%wx%h;", "info:out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" ? await runMagickCli(argv, files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
            const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
