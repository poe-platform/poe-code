import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "stream", "command"] as const) {
    it.each([
        { options: ["-trim"], warnings: 1 },
        { options: ["-regard-warnings", "-trim"], warnings: 1 },
        { options: [], warnings: 0 },
        { options: ["-quiet", "-trim"], warnings: 0 },
        { options: ["-trim", "-trim"], warnings: 2 },
        { options: ["-quiet", "-trim", "+quiet", "-trim"], warnings: 1 },
    ])(`preserves a single pixel and its page while warning for $options (${mode})`, async ({ options, warnings }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = ["xc:red", "-repage", "4x3+2+1", ...options, "-write", "PNG32:/pixel.png", "-format", "%wx%h|%g", "info:/out"];
        let stderr = "";
        const sink = { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } };
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: sink,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : {
                filesystem, cwd: "/", ...(mode === "stream" ? { stderr: sink } : {}),
            });
        expect(result.exitCode).toBe(0);
        if ("stderr" in result) stderr += result.stderr;
        expect(stderr).toBe("magick: geometry does not contain image 'red'\n".repeat(warnings));
        const output = mode === "map" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe("1x1|4x3+2+1");
        const pixel = decodeImage(mode === "map" || mode === "sync" ? files.get("/pixel.png")! : await filesystem.readFile("/pixel.png"));
        expect([pixel.width, pixel.height, ...pixel.data]).toEqual([1, 1, 255, 0, 0, 255]);
    });
}

for (const mode of ["map", "retained", "stream"] as const) {
    for (const foreground of [false, true]) {
        it(`warns only for an empty trim (mode=${mode}, foreground=${foreground})`, async () => {
            const pixels = new Uint8Array(9 * 7 * 4).fill(255);
            if (foreground) pixels.set([255, 0, 0, 255], (3 * 9 + 4) * 4);
            const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
            const files = new Map([["/white.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/white.png", input);
            let stderr = "";
            const backend = mode === "map" ? files : { filesystem, cwd: "/", ...(mode === "stream" ? {
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } : {}) };
            const result = await runMagickCli(["/white.png", "-trim", "/out.png"], backend);
            expect(result.exitCode).toBe(0);
            const warning = mode === "stream" ? stderr : result.stderr;
            if (foreground) expect(warning).toBe("");
            else expect(warning).toContain("geometry does not contain image");
            if (mode === "stream") expect(result.stderr).toBe("");
            const output = decodeImage(mode === "map" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
            expect(Array.from(output.data)).toEqual(foreground ? [255, 0, 0, 255] : [255, 255, 255, 0]);
        });
    }
}

for (const mode of ["map", "sync", "retained", "stream", "command"] as const) {
    it.each([
        { operands: ["first.miff", "middle.miff", "second.miff"], quiet: false },
        { operands: ["second.miff", "middle.miff", "first.miff"], quiet: false },
        { operands: ["middle.miff"], quiet: false },
        { operands: ["first.miff", "middle.miff", "second.miff"], quiet: true },
    ])(`names empty trim inputs in operand order (${mode}): $operands, quiet=$quiet`, async ({ operands, quiet }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x3", "xc:white", "-write", "first.miff", "+delete",
            "xc:black", "-write", "second.miff", "+delete", "xc:white", "-fill", "red", "-draw", "point 1,1",
            "-write", "middle.miff", "+delete", ...operands, ...(quiet ? ["-quiet"] : []),
            "-trim", "-format", "%f:%wx%h:%g;", "info:"];
        let stdout = "", stderr = "";
        const sink = { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } };
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } }, stderr: sink,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : {
                filesystem, cwd: "/", ...(mode === "stream" ? { stderr: sink } : {}),
            });
        expect(result.exitCode).toBe(0);
        if ("stderr" in result) stderr += result.stderr;
        if ("stdout" in result) stdout += result.stdout;
        expect(stdout).toBe(operands.map(name => `${name}:1x1:3x3${name === "middle.miff" ? "+1+1" : "-1-1"};`).join(""));
        expect(stderr).toBe(quiet ? "" : operands.filter(name => name !== "middle.miff")
            .map(name => `magick: geometry does not contain image '${name}'\n`).join(""));
    });
}
