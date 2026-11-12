import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 12x10 8-bit gray rasters.
const fixtures = [
    ["ellipse 5,4 3,2 0,360", "abba3c4eb7cbfd7ac76840b2f35cfe6ec14f9411c310e948c5ff6fb13702c2ec"],
    ["ellipse 5,4 3,2 0,180", "8df2441d531f0779a8d3735f71d4d7386311f84b2485f5966a506a94523e1bdb"],
    ["ellipse 5,4 3,2 180,360", "56399e3afd791e2197f1eab9647214c7db3edc9f32ed995832cd17d53ea0f387"],
    ["ellipse 5,4 3,2 90,270", "d7adeb8c47bfbb69fb08f8488de9377905291d864321d311006a1aedfa830d03"],
    ["ellipse 5,4 3,2 270,90", "a1981837a5ca64becfd5e5a310b2c49e708d44cbb09abe54810ba4facde17411"],
    ["ellipse 5,4 3,2 45,45", "9088fee917e5a748c2f0b4f5458c1cbdabbd696291c69be6e605bae0ef779e8f"],
    ["ellipse 5,4 0,2 0,360", "9088fee917e5a748c2f0b4f5458c1cbdabbd696291c69be6e605bae0ef779e8f"],
    ["translate 1,1 ellipse 4,3 3,2 90,270", "d7adeb8c47bfbb69fb08f8488de9377905291d864321d311006a1aedfa830d03"],
    ["ellipse 5,4 3,2 -90,90", "a1981837a5ca64becfd5e5a310b2c49e708d44cbb09abe54810ba4facde17411"],
    ["ellipse 5,4 3,2 30,120", "1032b7999079ca530e8e10a636b2bdf57b0e9c2dfa63fbfaa50b53466535cd9b"],
    ["circle 5,4 8,4", "df1c02c32d20c2c6441c93f28ffb418492b7e990be84c96c0e83bc24b2376a7c"],
    ["rectangle 2,2 8,6", "c846d17758f31ae1b757556f83edbc66eb5d60b84ae183c9048d751cee4209b7"],
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
