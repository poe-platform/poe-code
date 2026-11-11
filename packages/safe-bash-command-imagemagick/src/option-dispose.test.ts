import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: disposal settings affect subsequent inputs, including groups.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "unset", setting: [], reset: [], disposal: [0, 0, 0], restored: false },
        { name: "direct", setting: ["-dispose", "Previous"], reset: [], disposal: [0, 3, 3], restored: true },
        { name: "option", setting: ["-set", "option:dispose", "Previous"], reset: [], disposal: [0, 3, 3], restored: true },
        { name: "numeric option", setting: ["-set", "option:dispose", "3"], reset: [], disposal: [0, 3, 3], restored: true },
        { name: "normalized option", setting: ["-set", "option:dispose", "pRe-vi_ous"], reset: [], disposal: [0, 3, 3], restored: true },
        { name: "expanded option", setting: ["-set", "option:dispose", "%[fx:w+1]"], reset: [], disposal: [0, 3, 3], restored: true },
        { name: "option overrides direct", setting: ["-dispose", "None", "-set", "option:dispose", "Previous"], reset: [], disposal: [0, 3, 3], restored: true },
        { name: "direct overrides option", setting: ["-set", "option:dispose", "Previous", "-dispose", "None"], reset: [], disposal: [0, 1, 1], restored: false },
        { name: "remove option", setting: ["-set", "option:dispose", "Previous"], reset: ["+set", "option:dispose"], disposal: [0, 3, 0], restored: true },
        { name: "undefined option", setting: ["-set", "option:dispose", "Previous"], reset: ["-set", "option:dispose", "Undefined"], disposal: [0, 3, 0], restored: true },
        { name: "invalid option", setting: ["-set", "option:dispose", "invalid"], reset: [], disposal: [0, 7, 7], restored: false },
        { name: "reset disposal", setting: ["-set", "option:dispose", "Previous"], reset: ["+dispose"], disposal: [0, 3, 0], restored: true },
    ])(`${mode}: $name preserves GIF disposal and displayed pixels`, async ({ setting, reset, disposal, restored }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "2x1", "xc:red", ...setting, "-size", "1x1", "xc:blue", ...reset,
            "(", "-size", "1x1", "xc:lime", "-repage", "2x1+1+0", ")", "-write", "/out.gif", "gif:-"];
        const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const copy = mode === "command" || mode === "retained" ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
        const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        for (const output of [copy, stdout]) {
            expect([0, 1, 2].map(page => decodeImage(output, { page, coalesce: false }).disposal)).toEqual(disposal);
            const pixels = [0, 1, 2].map(page => Buffer.from(decodeImage(output, { page, coalesce: true }).data).toString("hex")).join("");
            expect(pixels).toBe("ff0000ffff0000ff0000ffffff0000ff" + (restored ? "ff0000ff" : "0000ffff") + "00ff00ff");
        }
    });
}
