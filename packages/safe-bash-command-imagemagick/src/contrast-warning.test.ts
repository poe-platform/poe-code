import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["-", "+"])(`warns for %scontrast while preserving pixels via ${mode}`, async sign => {
        // Native magick xc:#2060a0 xc:#c04010 xc:#5070b0 +append -strip PNG24:-.
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAAEklEQVQI12NQSFhwwEEgoGADABEKA6ELQwJoAAAAAElFTkSuQmCC", "base64");
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-channel", "R", `${sign}contrast`, "+channel", "/out.png"];
        let stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} },
                stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
            }), stderr
        } : mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: `magick: option has been replaced '${sign}contrast', use "${sign}level"\n` });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(sign === "-"
            ? [34, 101, 169, 255, 205, 68, 17, 255, 85, 119, 188, 255]
            : [30, 91, 151, 255, 179, 60, 15, 255, 75, 105, 164, 255]);
    });
}
