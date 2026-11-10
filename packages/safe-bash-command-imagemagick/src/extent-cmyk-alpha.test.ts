import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI composites the four inks independently.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["#b5267382", "1x1", "00672f26ff"],
        ["#b52673", "1x1", "00c95d4aff"],
        ["#b5267382", "2x1", "00672f26ff00000000ff"],
        ["#b5267300", "1x1", "00000000ff"],
        ["#b5267382", "1x1+2+0", "00000000ff"],
    ])(`${mode}: extent composites CMYK %s over white at %s`, async (color, geometry, expected) => {
        const argv = [`xc:${color}`, "-colorspace", "CMYK", "-background", "white", "-extent", geometry, "-depth", "8", "cmyka:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
