import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "static comment", input: ["xc:red", "xc:blue", "+append"], settings: ["-comment", "hello"], reads: ["mpr:a"], expected: "hello;" },
        { name: "assembled dimensions", input: ["xc:red", "xc:blue", "+append"], settings: ["-comment", "hello-%w"], reads: ["mpr:a"], expected: "hello-2;" },
        { name: "selected frame dimensions", input: ["-size", "2x3", "xc:red", "-size", "4x1", "xc:blue"], settings: ["-comment", "%wx%h"], reads: ["mpr:a[1,0]"], expected: "4x1;2x3;" },
        { name: "preserved saved comment", input: ["xc:red", "-set", "comment", "saved"], settings: [], reads: ["mpr:a"], expected: "saved;" },
        { name: "replaced saved comment", input: ["xc:red", "-set", "comment", "saved"], settings: ["-comment", "new"], reads: ["mpr:a"], expected: "new;" },
        { name: "empty active comment", input: ["xc:red", "-set", "comment", "saved"], settings: ["-comment", ""], reads: ["mpr:a"], expected: ";" },
        { name: "repeated reads preserve register properties", input: ["xc:red", "-set", "comment", "saved"], settings: ["-comment", "%c-new"], reads: ["mpr:a", "mpr:a"], expected: "saved-new;saved-new;" },
    ])(`applies MPR comments in ${mode}: $name`, async ({ input, settings, reads, expected }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = [...input, "-write", "mpr:a", "-delete", "0--1", ...settings, ...reads, "-format", "%c;", "info:"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), registerCleanup() {},
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
