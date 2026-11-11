import { expect, it } from "vitest";
import { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: 5 plays writes 4 repeats, 1 omits the extension,
// and 0 writes an infinite repeat count, with either spelling of the option.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "finite option", setting: ["-set", "option:loop", "5"], loop: 5 },
        { name: "single play option", setting: ["-set", "option:loop", "1"], loop: 1 },
        { name: "infinite option", setting: ["-set", "option:loop", "0"], loop: 0 },
        { name: "finite direct option", setting: ["-loop", "5"], loop: 5 },
        { name: "single play direct option", setting: ["-loop", "1"], loop: 1 },
        { name: "infinite direct option", setting: ["-loop", "0"], loop: 0 },
        { name: "option before input", setting: ["-set", "option:loop", "5"], loop: 5, before: true },
        { name: "expanded option", setting: ["-set", "option:loop", "%[fx:n+3]"], loop: 5 },
    ])(`${mode}: $name controls GIF repeats`, async ({ setting, loop, before }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const inputs = ["xc:red", "xc:blue"];
        const args = [...(before ? [...setting, ...inputs] : [...inputs, ...setting]), "-write", "copy.gif", "gif:-"];
        const argumentValues = createCommandArguments(args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const copy = mode === "command" || mode === "retained" ? await fs.readFile("/copy.gif") : files.get("copy.gif")!;
        const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        for (const bytes of [copy, stdout]) {
            const extension = Buffer.from(bytes).indexOf("NETSCAPE2.0");
            if (loop === 1) expect(extension).toBe(-1);
            else {
                expect(extension).toBeGreaterThan(-1);
                expect([...bytes.subarray(extension + 11, extension + 16)]).toEqual([3, 1, loop === 0 ? 0 : loop - 1, 0, 0]);
            }
            expect(readImageMetadata(bytes)).toMatchObject({ pages: 2, delay: [0, 0] });
        }
    });
}
