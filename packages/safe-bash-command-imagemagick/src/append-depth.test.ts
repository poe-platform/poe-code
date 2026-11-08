import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native: magick -size 2x1 'xc:#123456789abc' -strip PNG48:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLWHgYGBgYEBABS2Amwu+cPfAAAAAElFTkSuQmCC", "base64");

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each(["+append", "-append"])(`${mode}: preserves exact opaque RGB16 samples with %s`, async direction => {
        const argv = ["in.png", "in.png", direction, "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual(direction === "+append" ? [4, 1] : [2, 2]);
        expect(image.data16 && [...image.data16]).toEqual(Array.from({ length: 4 }, () => [0x1234, 0x5678, 0x9abc, 0xffff]).flat());
    });
}
