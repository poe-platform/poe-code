import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGBA8 stdout, with
// MAGICK_MEMORY_LIMIT=0 MAGICK_MAP_LIMIT=0 for zero-initialized disk caches.
// Native memory caches are uninitialized and produce allocator-dependent alpha.
const strip = ["xc:#12345640", "xc:#8badcf80", "xc:#fedcbac0"];
const cases = [
    { input: [...strip, "+append"], region: "1x1+1+0", geometry: "2x1!", hex: ["8badcf80fedcbac0", "8badcf80fedcbac0"] },
    { input: [...strip, "-append"], region: "1x1+0+1", geometry: "1x2!", hex: ["8badcf80fedcbac0", "8badcf80fedcbac0"] },
    { input: [...strip, "+append"], region: "1x1+0+0", geometry: "2x1!", hex: ["8badcf80e2d3c3b0", "8badcf80dccec0a8"] },
    { input: [...strip, "+append"], region: "1x1+1+0", geometry: "3x1!", hex: ["123456408badcf80fedcbac0", "123456408badcf80fedcbac0"] },
    { input: [...strip, "+append"], region: "1x1+1+0", geometry: "5x1!", hex: ["123456402e60924ffedcbac0e3d3c4b1ffdfb7c5", "123456404c739956fedcbac0ddcfc1aaffddbac1"] },
    { input: ["-size", "4x3", "gradient:#12345640-#fedcbac0"], region: "2x1+1+1", geometry: "2x2!", hex: ["c3b2a180c3b2a180fedcbac0fad9b8b9", "c3b2a180c3b2a180fedcbac0f7d7b7b6"] },
    { input: ["-size", "6x3", "gradient:#12345640-#fedcbac0"], region: "2x1+1+1", geometry: "2x1!", hex: ["fedcbac0fedcbac0", "fedcbac0fedcbac0"] },
    { input: ["-size", "10x5", "gradient:#12345640-#fedcbac0"], region: "2x1+1+1", geometry: "2x1!", hex: ["0000000000000000", "e6cbb0a0e6cbb0a0"] },
    { input: [...strip, "+append"], region: "1x1+1+0", geometry: "2x1!", post: ["-negate", "+region"], hex: ["7452307fbfa890c0", "7452307fbfa890c0"] },
    { input: [...strip, "+append"], region: "1x1+1+0", geometry: "2x1!", post: ["+region", "-negate"], hex: ["7452307f0123453f", "7452307f0123453f"] },
];
for (const operation of ["-thumbnail", "-resize"]) for (const mode of ["sync", "map", "retained", "command"]) {
    it.each(cases)(`honors an active region during ${operation} (${mode}): %j`, async ({ input, region, geometry, post, hex }) => {
        const args = [...input, "-region", region, operation, geometry, ...(post ?? ["+region"]), "-depth", "8", "rgba:-"];
        const filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "", exitCode: number;
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            exitCode = result.exitCode;
        } else {
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout = Buffer.from(result.stdoutBytes ?? []).toString("hex");
        }
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(stdout).toBe(hex[operation === "-thumbnail" ? 0 : 1]);
    });
}
