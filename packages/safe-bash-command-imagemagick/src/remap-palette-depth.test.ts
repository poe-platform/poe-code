import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native Q16-HDRI preserves the exact reference color in all eight source pixels.
const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAABCAIAAABsYngUAAAAIklEQVR4nGP4z8DwQYOV4T8D1wkRBob/croLvL29t2zZAgBmEgjpoGIlEgAAAABJRU5ErkJggg==", "base64"));
const palette16 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAIAAADA54+dAAAAD0lEQVR4nGMQMgmrmLUHAAYnAmsO3tV6AAAAAElFTkSuQmCC", "base64"));
const palette8 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC", "base64"));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([[["+dither"]], [["-dither", "FloydSteinberg"]], [["-dither", "Riemersma"]]])(`${mode}: retains reference palette precision with %j`, async (options) => {
        for (const [palette, color] of [[palette16, [0x1234, 0x5678, 0x9abc, 65535]], [palette8, [0, 0, 65535, 65535]]] as const) {
            const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.png", ...options, "-remap", "palette.png", "PNG64:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            const decoded = decodeImage(output);
            expect(Array.from(decoded.data16!)).toEqual(Array.from({ length: 8 }, () => [...color]).flat());
        }
    });
}
