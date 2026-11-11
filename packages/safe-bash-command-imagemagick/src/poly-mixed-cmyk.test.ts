import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: even an input without a polynomial term
// selects CMYK output, where the first image's RGB samples become CMY inks.
for (const mode of ["sync", "map", "retained", "command"] as const)
for (const width of [1, 513]) {
    it.each([
        { first: false, second: true, space: "CMYK", rgb: "cc9966" },
        { first: false, second: false, space: "sRGB", rgb: "336699" },
        { first: true, second: true, space: "CMYK", rgb: "336699" },
    ])(`${mode}, width=${width}: CMYK inputs $first/$second`, async ({ first, second, space, rgb }) => {
        for (const report of [true, false]) {
            const fs = createMemoryFileSystem(), files = new Map<string, Uint8Array>();
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const args = ["-size", `${width}x1`, "(", "xc:#336699", ...(first ? ["-colorspace", "CMYK"] : []), ")",
                "(", "xc:#cc8040", ...(second ? ["-colorspace", "CMYK"] : []), ")", "-poly", "1,1",
                ...(report ? ["-format", "%[colorspace]", "info:-"] : ["+channel", "-colorspace", "sRGB", "-depth", "8", "rgb:-"])];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(stdout)
                : report && "stdout" in result ? Buffer.from(result.stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(output).toString(report ? "utf8" : "hex")).toBe(report ? space : rgb.repeat(width));
        }
    });
}
