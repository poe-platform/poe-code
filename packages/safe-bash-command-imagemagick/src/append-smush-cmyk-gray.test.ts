import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian 16-bit pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operator of ["-append", "+append", "-smush", "+smush"])
it.each([
    { background: "gray50", format: "cmyka", crop: "1x1+1+1", hex: "0000000000008080ffff" },
    { background: "gray50", format: "rgba", crop: "1x1+1+1", hex: "7f7f7f7f7f7fffff" },
    { background: "graya(50%,0.5)", format: "cmyka", crop: "1x1+1+1", hex: "00000000000080008000" },
    { background: "#7f7f7f", format: "cmyka", crop: "1x1+1+1", hex: "000000000000c9aaffff" },
    { background: "gray50", format: "cmyka", crop: "1x1+0+0", hex: "0000ffffffff0000ffff" },
])(`${mode} ${operator}: $background $format $crop`, async ({ background, format, crop, hex }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-size", "2x1", "xc:red", "-size", "1x2", "xc:blue", "-colorspace", "CMYK", "-background", background,
        operator, ...(operator.endsWith("smush") ? ["0"] : []), "-crop", crop, "+repage",
        ...(format === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", "16", "-endian", "MSB", `${format}:/out`];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
