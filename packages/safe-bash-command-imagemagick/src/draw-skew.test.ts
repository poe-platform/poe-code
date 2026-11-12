import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, entire 12x10 8-bit gray raster.
const fixtures = [
    ["skewX 45 point 3,3", "89ea7097030b0e46e03ef9fae56e71b2ba9dae5c6f532a33424e2f0798f98630"],
    ["skewY 45 point 3,3", "c9bbd65f9784d3b3da4a5518d1138474ac92e274b172313dab49a6733c4267a2"],
    ["skewX 0 point 2,1", "105ce7d37ae9042734de6d4829a3b2eacd1bea98747c5268395c8aed148aee09"],
    ["skewY 0 point 2,1", "105ce7d37ae9042734de6d4829a3b2eacd1bea98747c5268395c8aed148aee09"],
    ["point 2,1", "105ce7d37ae9042734de6d4829a3b2eacd1bea98747c5268395c8aed148aee09"],
] as const;

for (const mode of ["map", "filesystem", "command"]) {
    it.each(fixtures)(`${mode}: matches native %s`, async (draw, hash) => {
        const args = ["-size", "12x10", "xc:white", "-fill", "black", "-stroke", "none", "-draw", draw, "-depth", "8", mode === "command" ? "gray:-" : "out.gray"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } }, registerCleanup() {}, fs: filesystem,
        } as unknown as CommandContext;
        const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : Buffer.concat(errors).toString()).toBe("");
        const pixels = mode === "command" ? Buffer.concat(chunks) : Buffer.from(mode === "map" ? files.get("out.gray")! : await filesystem.readFile("/out.gray"));
        expect(pixels.length).toBe(120);
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
    });
}
