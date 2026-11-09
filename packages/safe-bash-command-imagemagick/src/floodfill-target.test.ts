import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operator of ["-floodfill", "+floodfill"]) {
        it.each([
            { operands: [], missing: true },
            { operands: ["+0+0"], missing: true },
            { operands: ["+0+0", "#404860"], missing: false },
            { operands: ["+0+0", "-flop"], missing: false }
        ])(`${mode}: ${operator} consumes required operands $operands`, async ({ operands, missing }) => {
            const pixels = [64,72,96,255, 64,72,96,255, 0,0,0,255];
            const input = encodeImage({ width: 3, height: 1, data: Uint8Array.from(pixels),
                format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["in.png", input], ["out.png", original], ["#404860", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.png", "-fill", "lime", operator, ...operands, "PNG32:out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            if (missing) {
                expect(result.exitCode).not.toBe(0);
                expect(stderr).toContain(`missing argument '${operator}'`);
                expect(output).toEqual(original);
            } else {
                expect(result.exitCode, stderr).toBe(0);
                const invalid = operands[1] === "-flop";
                expect(stderr).toBe(invalid ? "magick: unrecognized color `-flop'\n" : "");
                const paint = invalid ? operator === "+floodfill" : operator === "-floodfill";
                expect([...decodeImage(output).data]).toEqual(paint ? [0,255,0,255, 0,255,0,255, 0,0,0,255] : pixels);
            }
        });
    }
}
