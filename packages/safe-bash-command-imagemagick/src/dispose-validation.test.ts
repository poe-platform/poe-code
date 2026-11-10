import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Verified against ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["typo", undefined], ["4", undefined], ["", undefined], ["00", undefined],
        ["+2", undefined], ["-1", undefined], ["2.0", undefined], ["pre vious", undefined],
        ["-previous", undefined], ["_previous", undefined], ["!typo", undefined],
        ["0", "Undefined"], ["1", "None"], ["2", "Background"], ["3", "Previous"],
        ["Undefined", "Undefined"], ["NONE", "None"], ["Previous", "Previous"],
        ["pre_vious", "Previous"], ["pre-vious", "Previous"], ["  Background", "Background"],
        ["Previous ", "Previous"], ["previous_", "Previous"], ["2-", "Background"],
        ["previous,typo", "Previous"], ["previous|none", "Previous"], ["previous none", "Previous"],
        [",previous", "Previous"], ["!previous", "Undefined"],
    ] as const)(`${mode}: validates -dispose %j before output`, async (value, expected) => {
        const keep = new TextEncoder().encode("KEEP");
        for (const output of expected === undefined ? ["saved.gif", "gif:-"] : ["info:-", "saved.gif"]) {
            const files = new Map([["saved.gif", keep]]), fs = new MemoryFileSystem();
            await fs.writeFile("/saved.gif", keep);
            const args = ["-dispose", value, "xc:red", "xc:blue", "-format", "%D;", output];
            let stdout = "", stderr = "", bytesWritten = 0;
            let exitCode: number;
            if (mode === "command") {
                const result = await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { bytesWritten += bytes.length; stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                exitCode = result.exitCode;
            } else {
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                exitCode = result.exitCode;
                stdout = result.stdout;
                stderr = result.stderr;
                bytesWritten = result.stdoutBytes?.length ?? stdout.length;
            }
            const saved = mode === "command" || mode === "retained" ? await fs.readFile("/saved.gif") : files.get("saved.gif")!;
            expect(exitCode).toBe(expected === undefined ? 1 : 0);
            if (expected === undefined) {
                expect(stderr).toContain(`unrecognized dispose method '-dispose' '${value}'`);
                expect(bytesWritten).toBe(0);
                expect(saved).toEqual(keep);
            } else {
                expect(stderr).toBe("");
                if (output === "info:-") expect(stdout).toBe(`${expected};${expected};`);
                else {
                    const disposal = ["Undefined", "None", "Background", "Previous"].indexOf(expected);
                    // Each 1x1 frame has a graphic control extension before its image descriptor.
                    const extensions = [...saved.keys()].filter(i => saved[i] === 33 && saved[i + 1] === 249 && saved[i + 2] === 4);
                    expect(extensions.map(i => (saved[i + 3]! >>> 2) & 7)).toEqual([disposal, disposal]);
                }
            }
        }
    });
}
