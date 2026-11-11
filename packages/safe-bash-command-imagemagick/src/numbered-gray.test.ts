import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// ImageMagick's X11 numbered gray palette, shared by the gray and grey aliases.
const samples = [
    0, 3, 5, 8, 10, 13, 15, 18, 20, 23, 26, 28, 31, 33, 36, 38, 41, 43, 46, 48,
    51, 54, 56, 59, 61, 64, 66, 69, 71, 74, 77, 79, 82, 84, 87, 89, 92, 94, 97, 99,
    102, 105, 107, 110, 112, 115, 117, 120, 122, 125, 127, 130, 133, 135, 138, 140, 143, 145, 148, 150,
    153, 156, 158, 161, 163, 166, 168, 171, 173, 176, 179, 181, 184, 186, 189, 191, 194, 196, 199, 201,
    204, 207, 209, 212, 214, 217, 219, 222, 224, 227, 229, 232, 235, 237, 240, 242, 245, 247, 250, 252, 255,
];

it.each([
    ...samples.flatMap((sample, number) => [
        { color: `gray${number}`, sample }, { color: `grey${number}`, sample },
    ]),
    { color: "GrAy50", sample: 127 },
    { color: "GrEy90", sample: 229 },
    { color: "gray(50%)", sample: 128 },
    { color: "grey(50%)", sample: 128 },
    { color: "gray(90%)", sample: 230 },
    { color: "#7f7f7f", sample: 127 },
    { color: "#808080", sample: 128 },
])("reads the native sample for xc:$color through the public command", async ({ color, sample }) => {
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick",
        args: createCommandArguments([`xc:${color}`, "-format", "%[fx:round(255*u.r)]", "info:"]).args,
        cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(String(sample));
});

it.each([
    { color: "gray50", hex: "7f7f7f7f7f7fffff" },
    { color: "grey90", hex: "e5e5e5e5e5e5ffff" },
    { color: "#808080", hex: "808080808080ffff" },
])("writes native 16-bit RGBA samples for xc:$color", async ({ color, hex }) => {
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick",
        args: createCommandArguments([`xc:${color}`, "-depth", "16", "-endian", "MSB", "rgba:-"]).args,
        cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
});
