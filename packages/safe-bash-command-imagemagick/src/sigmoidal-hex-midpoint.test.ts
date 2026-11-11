import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["-sigmoidal-contrast", "5x0x10%", "198dd91cdefcf3f774"],
        ["+sigmoidal-contrast", "5,0x10%", "092d530a57a7788625"],
        ["+sigmoidal-contrast", "5x16%", "092d530a57a7788625"],
        ["-sigmoidal-contrast", "5x0x4000", "1378ce15d4fbeff460"],
        ["-sigmoidal-contrast", "5x16384", "1378ce15d4fbeff460"],
        ["-sigmoidal-contrast", "5x0%", "26a9e62be9fdf7fa92"]
    ])(`${mode}: %s %s matches native midpoint pixels`, async (option, geometry, expected) => {
        // ImageMagick 7.1.2-35 Q16-HDRI, with the same PPM and argv.
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input], ["out", sentinel]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", sentinel);
        const argv = ["a.ppm", option, geometry, "-depth", "8", "rgb:out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
    it.each([
        ["5x-0x1000", "5x-4096"],
        ["5x+0x1000", "5x+4096"],
        ["5,-0x1000", "5,-4096"],
        ["5,+0x1000", "5,+4096"],
        ["5x0x2e", "5x46", "f6c493b5d3dedc68", "5e9a1ac7320837a9"],
        ["5x0x2E", "5x46", "f6c493b5d3dedc68", "5e9a1ac7320837a9"],
        ["5,0x2e", "5x46", "f6c493b5d3dedc68", "5e9a1ac7320837a9"],
        ["5x2e", "5x2", "f6c893d0d3eddc75", "5e881abe31fb379a"],
        ["5x2E", "5x2", "f6c893d0d3eddc75", "5e881abe31fb379a"],
        ["5x2.e", "5x2", "f6c893d0d3eddc75", "5e881abe31fb379a"],
        ["5x0x2e%", "5x46%"],
        ["5x0x20", "5x32"],
        ["5x0x2e0", "5x736"],
        ["5e"],
        ["5x0x2f%"]
    ])(`command: ${option} %s preserves native midpoint parsing`, async (geometry, equivalent?: string, forward?: string, inverse?: string) => {
        // ImageMagick 7.1.2-35 Q16-HDRI, including alpha and 16-bit output.
        const outputs: string[] = [];
        for (const value of equivalent === undefined ? [geometry] : [geometry, equivalent]) {
            const args = createCommandArguments(["xc:#bc427580", option, value, "-depth", "16", "-endian", "MSB", "rgba:-"]);
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            const output = Buffer.concat(stdout).toString("hex");
            expect(result.exitCode, stderr).toBe(equivalent === undefined ? 1 : 0);
            if (equivalent === undefined) {
                expect(output).toBe("");
                expect(stderr).toContain(`invalid argument for option '${option}'`);
            } else {
                expect(output).toHaveLength(16);
                if (forward !== undefined) expect(output).toBe(option === "-sigmoidal-contrast" ? forward : inverse);
                outputs.push(output);
            }
        }
        if (equivalent !== undefined) expect(outputs[0]).toBe(outputs[1]);
    });
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["5x-0x1000", "82c0f2"],
        ["5x-4096", "82c0f2"],
        ["5x0", "79b9f1"],
        ["5x+0x1000", "214dbb"],
        ["5x+4096", "214dbb"]
    ])(`${mode}: signed midpoint %s matches native pixels`, async (geometry, expected) => {
        // ImageMagick 7.1.2-35 Q16-HDRI with the same color and arguments.
        const argv = ["xc:#345caa", "-sigmoidal-contrast", geometry, "-depth", "8", "rgb:out"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
