import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Channel metadata and complete RGBA bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["map", "filesystem", "sync", "command"] as const)
for (const format of ["info", "rgba"] as const) {
    it.each([
        { name: "RGB without drawing", operations: [], channels: "srgb  3.0", hex: "ff0000ffff0000ff" },
        { name: "negated RGB without drawing", operations: ["-negate"], channels: "srgb  3.0", hex: "00ffffff00ffffff" },
        { name: "explicit alpha", operations: ["-alpha", "set", "-negate"], channels: "srgba 4.0", hex: "00ffff0000ffff00" },
        { name: "opaque point", operations: ["-fill", "blue", "-draw", "point 0,0", "-negate"], channels: "srgba 4.0", hex: "ffff000000ffff00" },
        { name: "opaque rectangle", operations: ["-fill", "blue", "-draw", "rectangle 0,0 1,0", "-negate"], channels: "srgba 4.0", hex: "ffff0000ffff0000" },
        { name: "off-canvas point", operations: ["-fill", "blue", "-draw", "point 8,8", "-negate"], channels: "srgba 4.0", hex: "00ffff0000ffff00" },
        { name: "same-color point", operations: ["-fill", "red", "-draw", "point 0,0", "-negate"], channels: "srgba 4.0", hex: "00ffff0000ffff00" },
        { name: "draw metadata", operations: ["-fill", "blue", "-draw", "point 0,0"], channels: "srgba 4.0", hex: "0000ffffff0000ff" },
    ])(`${mode} ${format}: $name retains native alpha activation`, async ({ operations, channels, hex }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", original);
        const args = ["-size", "2x1", "xc:red", ...operations, "-format", "%wx%h %g %[channels]", "-depth", "8", `${format}:out`];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
        } as unknown as CommandContext;
        const result = mode === "command" ? await createMagickCommand().execute(context)
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "map" || mode === "sync" ? files.get("out")! : await filesystem.readFile("/out");
        if (format === "info") expect(new TextDecoder().decode(output)).toBe(`2x1 2x1+0+0 ${channels}`);
        else expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
