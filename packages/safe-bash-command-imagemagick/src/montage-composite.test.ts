import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Pixel output verified against ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const test of [
    { name: "opaque", color: "blue", mask: [], composite: true, height: 1, pixels: "0000ffff0000" },
    { name: "translucent", color: "#0000ff80", mask: [], composite: true, height: 1, pixels: "7f0080ff0000" },
    { name: "black mask", color: "blue", mask: ["-size", "1x1", "xc:black"], composite: true, height: 1, pixels: "ff0000ff0000" },
    { name: "white mask", color: "blue", mask: ["-size", "1x1", "xc:white"], composite: true, height: 1, pixels: "0000ffff0000" },
    { name: "separate tiles", color: "blue", mask: [], composite: false, height: 2, pixels: "ff0000ff00000000ffffffff" }
]) {
    it(`${mode}: montage ${test.name} before tile placement`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-background", "white", "(", "-size", "2x1", "xc:red", "-repage", "3x1+0+0", ")",
            "(", "-size", "1x1", `xc:${test.color}`, "-repage", "3x1+1+0", ")", ...test.mask,
            ...(test.composite ? ["-composite"] : []), "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
        let stderr = "", bytes: Uint8Array | undefined, exitCode: number;
        if (mode === "magick" || mode === "montage") {
            const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
            const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
            const chunks: Uint8Array[] = [];
            exitCode = (await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            })).exitCode;
            bytes = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMontageCliSync(args, files)
                : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            ({ exitCode, stdoutBytes: bytes, stderr } = result);
        }
        expect(exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.from(bytes!)).toEqual(Buffer.concat([Buffer.from(`P6\n2 ${test.height}\n255\n`), Buffer.from(test.pixels, "hex")]));
    });
}
