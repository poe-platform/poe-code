import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including unchanged endpoints.
for (const mode of ["map", "sync", "filesystem", "command"])
for (const png of [false, true])
it.each([
    { first: "Lab", second: "CMYK", count: "1", expected: "272a545483828080115431cb099d6060efefa0a034344040" },
    { first: "HSL", second: "CMYK", count: "1", expected: "2727545483838080759dc0255d7c6060efefa0a034344040" },
    { first: "Lab", second: "CMYK", count: "0", expected: "272a545483828080efefa0a034344040" },
    { first: "HSL", second: "CMYK", count: "0", expected: "2727545483838080efefa0a034344040" },
    { first: "Lab", second: "Lab", count: "1", expected: "272a5454838280809c6e78b363ea6060eff2a09b342f4040" },
    { first: "HSL", second: "HSL", count: "1", expected: "272754548383808022ffc4682a226060efefa0a034344040" }
])(`preserves Q16 morph $first/$second, count=$count (${mode}, PNG64=${png})`, async ({ first, second, count, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = ["(", "xc:#27548380", "-colorspace", first, ")", "(", "xc:#efa03440", "-colorspace", second, ")", "-morph", count,
        "-colorspace", "sRGB", ...(png ? ["+append"] : []), "-depth", "16", "-endian", "MSB", png ? "PNG64:/out" : "rgba:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    if (png) {
        const pixels = decodeImage(output);
        expect(Array.from(pixels.data16!)).toEqual(Array.from({ length: expected.length / 4 }, (_, i) => parseInt(expected.slice(i * 4, i * 4 + 4), 16)));
    } else expect(Buffer.from(output).toString("hex")).toBe(expected);
});
