import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = [0, 40, 90, 0, 80, 100, 150, 128, 200, 50, 70, 255];
for (const execution of ["command", "buffered", "sync"] as const) {
    for (const mode of ["deactivate", "associate", "disassociate", "off"] as const) {
        it.each(["activate", "extract", "set", "remove", "none"])(`${execution}: ${mode} followed by %s`, async action => {
            const input = await sharp(Uint8Array.from(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
            const argv = ["in.png", "-background", "#123456", "-alpha", mode, "-write", "PNG32:inactive.png", ...(action === "none" ? [] : ["-alpha", action]), "PNG32:out.png"];
            const files = new Map<string, Uint8Array>([["in.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = execution === "sync" ? runMagickCliSync(argv, files)
                : execution === "buffered" ? await runMagickCli(argv, files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            const output = execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
            const expected = pixels.map((value, index) => {
                const alpha = mode === "off" ? 0 : pixels[Math.floor(index / 4) * 4 + 3]!;
                if (action === "extract") return index % 4 === 3 || mode === "off" ? 255 : alpha;
                if (index % 4 === 3) return action === "activate" ? alpha : 255;
                const scale = pixels[Math.floor(index / 4) * 4 + 3]! / 255;
                return mode === "associate" ? Math.round(value * scale)
                    : mode === "disassociate" ? Math.min(255, Math.round(value / Math.max(scale, 1e-12))) : value;
            });
            expect([...decodeImage(output).data]).toEqual(expected);
        });
    }
}
