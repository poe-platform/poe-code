import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: tag the input as Luv without converting it first.
it.each([
    { color: "white", hex: "ffffdecf0000ffff" },
    { color: "black", hex: "000000000000ffff" },
    { color: "gray50", hex: "a74261ba7cfdffff" },
    { color: "#fffefe", hex: "ffffddfa0000ffff" },
])("matches native RGBA16 when converting tagged Luv $color to sRGB", async ({ color, hex }) => {
    const argumentValues = createCommandArguments([
        `xc:${color}`, "-set", "colorspace", "Luv", "-colorspace", "sRGB",
        "-depth", "16", "-endian", "MSB", "rgba:-",
    ]);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
        fs: new MemoryFileSystem(), signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(Buffer.concat(stdout).toString("hex")).toBe(hex);
});
