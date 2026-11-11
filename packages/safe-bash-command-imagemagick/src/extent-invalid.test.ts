import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("./fixtures/extent-grid.png", import.meta.url)));

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["2", "2x+1+0", "2@+1+0", "2+1+0@", "2%+1+0", "2+1+0%", "+1+0"])(`accepts extent %s (${mode})`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["xc:red", "-background", "blue", "-extent", geometry, "-depth", "8", "rgb:/out"];
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
        if (geometry === "2" || geometry === "2x+1+0") {
            const output = mode === "retained" || mode === "command"
                ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(output).toEqual(Uint8Array.from(geometry === "2" ? [255, 0, 0, 0, 0, 255] : [0, 0, 255, 0, 0, 255]));
        }
    });

    it.each(["junk", "8x7+0+0bad", "2+1+0", "2-1-0", "7+1+1", "8x7"])(`validates extent %s before replacing a PNG (${mode})`, async geometry => {
        for (const expand of [false, true]) {
            const files = new Map([["/grid.png", input.slice()], ["/out.png", input.slice()]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/grid.png", input);
            await filesystem.writeFile("/out.png", input);
            const argv = ["/grid.png", "-background", "none",
                ...(expand ? ["-set", "option:extent-size", geometry] : []),
                "-extent", expand ? "%[option:extent-size]" : geometry, "PNG32:/out.png"];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const output = mode === "retained" || mode === "command"
                ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            if (geometry !== "8x7") {
                expect.soft(result.exitCode).toBe(1);
                expect.soft("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-extent'");
                expect(output).toEqual(input);
            } else {
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const original = decodeImage(input), extended = decodeImage(output);
                const expected = new Uint8Array(8 * 7 * 4);
                for (let y = 0; y < original.height; y++) {
                    expected.set(original.data.subarray(y * original.width * 4, (y + 1) * original.width * 4), y * 8 * 4);
                }
                expect([extended.width, extended.height]).toEqual([8, 7]);
                expect(extended.data).toEqual(expected);
            }
        }
    });
}
