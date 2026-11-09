import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("expands emboss geometry against the current image (%s)", async mode => {
    const input = new Uint8Array(readFileSync(new URL("./fixtures/emboss-expression.png", import.meta.url)));
    for (const [prefix, expression, literal] of [
        [[], "%[fx:w-10]x1", "1x1"],
        [[], "1x%[fx:h-7]", "1x2"],
        [["-resize", "7x5!"], "%[fx:w-6]x%[fx:h-4]", "1x1"],
        [["-set", "option:radius", "2"], "%[radius]x1", "2x1"]
    ] as const) {
        const outputs: Uint8Array[] = [];
        for (const geometry of [literal, expression]) {
            const files = new Map([["input.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            const args = ["input.png", ...prefix, "-emboss", geometry, "PNG32:o.png"];
            let stdout = "", stderr = "";
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
            outputs.push(decodeImage(mode === "buffered" || mode === "sync" ? files.get("o.png")! : await fs.readFile("/o.png")).data);
        }
        expect(outputs[1], expression).toEqual(outputs[0]);
        // ImageMagick 7.1.2-35: the reported radius expression produces 1x1.
        if (expression === "%[fx:w-10]x1") expect(Array.from(outputs[1]!.slice(0, 4))).toEqual([0, 0, 106, 255]);
    }
});
