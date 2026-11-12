import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 12x10 8-bit gray rasters.
const fixtures = [
    ["1,0,1,1,0,0", "af5a2c3c70f758228b9c0493e3a934717af5fbeebda5a1ed4cf6b431072914fc"],
    ["1,1,0,1,0,0", "6b85c0c6fc7f91ce02a2676bd0ef548ceb3ef2064a897c00bc5f1cde82a48a03"],
    ["1,0,0,1,2,3", "d3afd561cde2fdcdb7e97b434569e230e88521e2e405cfdf2321df29cf0f6f95"],
    ["2,0,0,3,0,0", "134867ac246b2c987ee074a23a31ee095b76c5e6013099fe94d327d9eee2691c"],
] as const;

for (const mode of ["map", "filesystem", "command"]) {
    it.each(fixtures)(`${mode}: matches native affine %s`, async (matrix, hash) => {
        const args = ["-size", "12x10", "xc:white", "-fill", "black", "-stroke", "none", "-draw", `affine ${matrix} point 2,1`, "-depth", "8", mode === "command" ? "gray:-" : "out.gray"];
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
