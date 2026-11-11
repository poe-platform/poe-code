import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, xc:#4080a080 -fill '#bf6050' -tint STRENGTH -depth 8 rgba:-.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["60x20+10", "40203c80"], ["60,20,10", "40203c80"],
        ["60x20-10", "40202d80"], ["60,20,-10", "40202d80"],
        ["60x20", "40206180"], ["60,20", "40206180"],
        ["60", "40476180"], ["60!", "40476180"], ["60@", "40476180"],
        ["60^", "40476180"], ["60<", "40476180"], ["60>", "40476180"],
        ["bogus", ""], ["30+10+15", ""],
    ])(`${mode}: matches native tint geometry %s`, async (strength, expected) => {
        const argv = ["xc:#4080a080", "-fill", "#bf6050", "-tint", strength, "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : new TextEncoder().encode("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(result.exitCode).toBe(expected ? 0 : 1);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        expect("stderr" in result ? result.stderr : stderr).toContain(expected ? "" : `invalid argument '-tint' '${strength}'`);
    });
}
