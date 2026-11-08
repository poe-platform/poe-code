import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([false, true])(`labels linear RGB TXT samples through ${mode}, alpha=%s`, async hasAlpha => {
        const { data } = encodeImage({ width: 2, height: 1, data: Uint8Array.of(18, 52, 86, hasAlpha ? 128 : 255, 171, 205, 239, hasAlpha ? 64 : 255), format: "png", space: "srgb", channels: hasAlpha ? 4 : 3, depth: "uchar", density: 72, hasAlpha }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const args = ["/in.png", "-colorspace", "RGB", "txt:-"];
        let stdout = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            stderr: { write: async () => {} },
        });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(hasAlpha
            ? "# ImageMagick pixel enumeration: 2,1,0,255,rgba\n0,0: (2,9,24,128)  #02091880  rgba(2,9,24,0.501961)\n1,0: (104,156,220,64)  #689CDC40  rgba(104,156,220,0.25098)\n"
            : "# ImageMagick pixel enumeration: 2,1,0,255,rgb\n0,0: (2,9,24)  #020918  rgb(2,9,24)\n1,0: (104,156,220)  #689CDC  rgb(104,156,220)\n");
    });
}
