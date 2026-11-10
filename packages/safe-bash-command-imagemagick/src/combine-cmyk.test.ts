import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const colorspace of ["CMYK", "sRGB"] as const) {
        for (const count of [3, 4]) {
            it.each(["info", "rgba"])(`${mode}: combines ${count} ${colorspace} operands into %s`, async output => {
                // Native ImageMagick 7.1.2-35 Q16-HDRI: the fourth CMYK plane is black, not alpha.
                const inputs = ["xc:#404040", "xc:#808080", "xc:#c0c0c0", "xc:#cccccc"].slice(0, count);
                const args = [...inputs, "-colorspace", colorspace, "-combine", ...(output === "info"
                    ? ["-format", "%[colorspace] %[channels]", "info:out"]
                    : ["-colorspace", "sRGB", "-depth", "8", "rgba:out"])];
                const fs = new MemoryFileSystem(), files = new Map([["out", new TextEncoder().encode("KEEP")]]);
                await fs.writeFile("/out", files.get("out")!);
                let stdout = "", stderr = "";
                const result = mode === "command" ? { ...await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
                const bytes = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
                if (output === "info") expect(new TextDecoder().decode(bytes)).toBe(colorspace === "CMYK" ? "CMYK cmyk  4.0" : count === 4 ? "sRGB srgba 4.0" : "sRGB srgb  3.0");
                else expect(Buffer.from(bytes).toString("hex")).toBe(colorspace === "CMYK" ? count === 4 ? "ffffffff" : "404040ff" : count === 4 ? "4080c0cc" : "4080c0ff");
            });
        }
    }
}

for (const retained of [false, true]) {
    it.each([3, 4])(`combines ink planes across chunk boundaries, retained=${retained}, operands=%i`, async count => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const inputs = ["xc:cmyk(100%,100%,100%,20%)", "xc:cmyk(0%,0%,0%,80%)", "xc:cmyk(100%,100%,100%,60%)", "xc:cmyk(0%,0%,0%,40%)"].slice(0, count);
        const result = await runMagickCli(["-size", "2051x1", ...inputs, "-combine", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:out"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = retained ? await fs.readFile("/out") : files.get("out")!;
        // C=1, M=0, Y=1; three operands retain K=0.2, four replace K with zero.
        const pixel = count === 3 ? [0, 0, 204, 204, 0, 0, 255, 255] : [0, 0, 255, 255, 0, 0, 255, 255];
        expect(output).toEqual(Uint8Array.from({ length: 2051 * 8 }, (_, index) => pixel[index % 8]!));
    });
}
