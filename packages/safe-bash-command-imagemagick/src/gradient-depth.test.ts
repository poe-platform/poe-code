import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { size: "1x5", input: "gradient:black-white", samples: [0, 0x4000, 0x8000, 0xbfff, 0xffff] },
        { size: "5x1", input: "gradient:black-white", samples: [0, 0x4000, 0x8000, 0xbfff, 0xffff] },
        { size: "1x4", input: "gradient:black-white", samples: [0, 0x5555, 0xaaaa, 0xffff] },
        { size: "1x1", input: "gradient:black-white", samples: [0] },
        { size: "5x1", input: "radial-gradient:black-white", samples: [0xffff, 0x8000, 0, 0x8000, 0xffff] }
    ])(`${mode}: preserves PNG64 gradient samples for $size $input`, async ({ size, input, samples }) => {
        const argv = ["-size", size, input, "PNG64:out.png"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const image = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(image.data16 && [...image.data16]).toEqual(samples.flatMap(value => [value, value, value, 0xffff]));
    });
}
