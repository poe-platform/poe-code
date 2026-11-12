import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: full 9x9, 8-bit grayscale rasters.
const fixtures = [
    { path: "M1,7 Q4,1 7,7 Z", row: "fffffe880088feffff", hash: "c9b5aea73967a5e84e3ca023512906078024c9ec5edb7f0b4a9d53ccf3334a68" },
    { path: "M1,7 C2,1 6,1 7,7 Z", row: "ffff2600000026ffff", hash: "aea5bbe8bdffd8bca992fa8faf32f4bf8f114312768118b4b2762a005c6f01a8" },
    { path: "M1,7 Q4,7 7,7 L7,3Z", row: "fffffffff87a0000ff", hash: "36184f3c63c45831c9f7e2d868ed9c545406701d3956f3b236eeb6e05a26693b" },
    { path: "M1,7 L7,7 L7,3Z", row: "fffffffff87a0000ff", hash: "36184f3c63c45831c9f7e2d868ed9c545406701d3956f3b236eeb6e05a26693b" },
];

for (const mode of ["map", "filesystem", "command"] as const) {
    it.each(fixtures)(`${mode}: matches native filled path $path`, async ({ path, row, hash }) => {
        const args = ["-size", "9x9", "xc:white", "-fill", "black", "-stroke", "none", "-draw", `path '${path}'`, "-depth", "8", mode === "command" ? "gray:-" : "gray:/out.gray"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [];
        const argumentValues = createCommandArguments(args);
        const context: CommandContext = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} },
        };
        const result = mode === "command" ? await createMagickCommand().execute(context)
            : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const pixels = mode === "command" ? Buffer.concat(chunks) : Buffer.from(mode === "map" ? files.get("/out.gray")! : await filesystem.readFile("/out.gray"));
        expect(pixels.length).toBe(81);
        expect(pixels.subarray(36, 45).toString("hex")).toBe(row);
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
    });
}
