import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 ignores parentheses around extent dimensions.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["(6)x5", "6x(5)", "(6)x(5)", "6x5"])(`reads parenthesized extent dimensions %s (${mode})`, async geometry => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const argv = ["-size", "4x3", "xc:#4080c080", "-extent", geometry,
            "-format", "%wx%h %W,%H,%X,%Y", "info:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command"
            ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe("6x5 6,5,+0,+0");
    });
}
