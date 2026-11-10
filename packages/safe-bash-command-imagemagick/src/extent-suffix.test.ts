import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["6x5#", "6x5+2+1#", "6x5,", "6x5,2", "6x5", "6x5+2+1"])(
        `preserves extent dimensions before suffixes: %s (${mode})`, async geometry => {
            // ImageMagick 7.1.2-35 reports the same dimensions and canvas for every case.
            for (const format of ["info", "rgba"]) {
                const sentinel = new TextEncoder().encode("KEEP");
                const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/out", sentinel);
                const argv = ["-size", "4x3", "xc:#4080c080", "-extent", geometry,
                    "-format", "%wx%h %W,%H,%X,%Y", "-depth", "8", `${format}:/out`];
                let stderr = "";
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
                if (format === "info") {
                    expect(new TextDecoder().decode(output)).toBe("6x5 6,5,+0,+0");
                } else {
                    const expected = new Uint8Array(6 * 5 * 4).fill(255);
                    const width = geometry.includes("+2+1") ? 2 : 4;
                    const height = geometry.includes("+2+1") ? 2 : 3;
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) expected.set([159, 191, 223, 255], (y * 6 + x) * 4);
                    }
                    expect(output).toEqual(expected);
                }
            }
        });
}
