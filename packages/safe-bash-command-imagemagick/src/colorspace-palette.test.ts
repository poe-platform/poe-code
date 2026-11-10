import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: converting Gray/RGB palettes to sRGB promotes storage.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const space of ["Gray", "RGB", "sRGB"]) {
        it.each([
            { quantize: true, convert: true },
            { quantize: true, convert: false },
            { quantize: false, convert: true },
        ])(`${mode}: ${space} palette quantize=$quantize, convert=$convert`, async ({ quantize, convert }) => {
            const args = ["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append",
                "-colorspace", space, ...(quantize ? ["+dither", "-colors", "2"] : []),
                ...(convert ? ["-colorspace", "sRGB"] : []), "-format", "%r|%k", "info:out"];
            const fs = new MemoryFileSystem();
            const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
            await fs.writeFile("/out", files.get("out")!);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
            const indexed = quantize && (!convert || space === "sRGB");
            expect(new TextDecoder().decode(output)).toBe(`${indexed ? "PseudoClass" : "DirectClass"} ${convert ? "sRGB" : space} |${quantize ? 2 : 5}`);
        });
    }
}
