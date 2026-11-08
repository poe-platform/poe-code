import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

for (const mode of ["public", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { gap: "1bad" }, { gap: "1x2bad" }, { gap: "1.9junk" },
            { gap: "1.9", size: 5 }, { gap: "2x3", size: 6 },
            { gap: "1/2", size: 5 }, { gap: "1,2", size: 5 },
            { gap: "1e2", size: 5 }, { gap: "1%", size: 5 },
        ])(`${mode} ${operation} validates the entire gap $gap`, async ({ gap, size }) => {
            const argumentValues = createCommandArguments(["-size", "2x2", "xc:red", "xc:blue", operation, gap, "out.png"]);
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let stderr = "";
            const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files)
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                });
            if (size === undefined) {
                expect(result.exitCode).not.toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toContain("Invalid smush geometry");
                if (mode === "sync") expect(files.has("out.png")).toBe(false);
                else await expect(fs.readFile("/out.png")).rejects.toThrow();
            } else {
                expect(result.exitCode).toBe(0);
                const output = mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png");
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual(operation === "+smush" ? [size, 2] : [2, size]);
            }
        });
    }
}
