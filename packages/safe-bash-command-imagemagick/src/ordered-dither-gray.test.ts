import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./ordered-dither-gray-fixtures.json" with { type: "json" };

// PNG32 output decoded to RGBA8 by ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const fixture of fixtures) {
        it.each(fixture.cases)(`${mode}: dithers ${fixture.name} with $args`, async ({ args, rgba }) => {
            const input = Buffer.from(fixture.input, "base64");
            const argv = [fixture.name, ...args, "PNG32:out.png"];
            const files = new Map<string, Uint8Array>([[fixture.name, input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile(`/${fixture.name}`, input);
            const arguments_ = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" ? await runMagickCli(argv, files)
                : await createMagickCommand().execute({
                    command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(decodeImage(output).data).toEqual(new Uint8Array(Buffer.from(rgba, "base64")));
        });
    }
}
