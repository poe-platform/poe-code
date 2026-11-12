import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Black/White fill CMYK channel samples,
// so their virtual pixels become white/black after conversion to sRGB.
for (const mode of ["sync", "map", "retained", "command"] as const)
for (const png of [false, true])
it.each([
    { space: "CMYK", method: "Black", size: "1x1", expected: "12345680ffffffff" },
    { space: "CMYK", method: "White", size: "1x1", expected: "12345680000000ff" },
    { space: "CMYK", method: "Edge", size: "1x1", expected: "1234568012345680" },
    { space: "sRGB", method: "Black", size: "1x1", expected: "12345680000000ff" },
    { space: "sRGB", method: "White", size: "1x1", expected: "12345680ffffffff" },
    { space: "CMYK", method: "Black", size: "2x1", expected: "1234568012345680" },
])(`${mode}, png=${png}: poly $space $method virtual pixels with $size input`, async ({ space, method, size, expected }) => {
    const argv = ["-size", "2x1", "xc:#27548380", "-size", size, "xc:#12345680",
        "-colorspace", space, "-virtual-pixel", method, "-poly", "0,1,1,1",
        "-colorspace", "sRGB", "-depth", "8", png ? "PNG32:-" : "rgba:-"];
    const fs = createMemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
