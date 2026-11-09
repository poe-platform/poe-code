import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./exr-fixtures.json" with { type: "json" };

// Native ImageMagick Q16-HDRI: apply gamma to .25 and .5 before PNG32 quantization.
for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it(`preserves fractional EXR samples through channel gamma (${mode})`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixtures["none-half"], "base64"));
        const files = new Map([["/in.exr", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.exr", bytes);
        const args = ["/in.exr", "-channel", "G", "-gamma", "2", "+channel", "PNG32:/out.png"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(Array.from({ length: 18 }, () => [255, 128, 0, 255, 0, 180, 255, 255]).flat());
    });
}
