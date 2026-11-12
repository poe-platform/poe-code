import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reads uninitialized destination mask samples
// when filling a resized append canvas (SetImageBackgroundColor calls
// ClipPixelCacheNexus). MALLOC_PERTURB_=1 produces transparent black padding;
// 170 produces white; 255 produces the requested background. Keep initialized
// background pixels, not allocator-dependent native bytes. Unmasked and
// equal-size controls match native regardless of allocator initialization.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+append", "-append"])
for (const masked of [false, true])
it.each([false, true])(`${mode} ${direction} first-frame mask=${masked}, equal-size=%s keeps initialized RGBA padding`, async (equalSize) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [
        "(", "-size", "2x1", "xc:#173e5970", "-colorspace", "sRGB", ...(masked ? ["-write-mask", "xc:white"] : []), ")",
        "(", "-size", equalSize ? "2x1" : "1x2", "xc:#b56829cf", "-colorspace", "sRGB", ")",
        "-background", "#31618a40", "-gravity", "SouthEast", direction, "+write-mask", "-depth", "8", "rgba:/out",
    ];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(equalSize
        ? "173e5970173e5970b56829cfb56829cf"
        : direction === "+append"
            ? "31618a4031618a40b56829cf173e5970173e5970b56829cf"
            : "173e5970173e597031618a40b56829cf31618a40b56829cf");
});
