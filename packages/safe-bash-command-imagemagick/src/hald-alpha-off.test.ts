import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves RGB and returns opaque alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "disabled alpha", alpha: ["-alpha", "Off"] },
        { name: "enabled then disabled alpha", alpha: ["-alpha", "set", "-alpha", "Off"] },
        { name: "plain cube", alpha: [] },
        { name: "opaque cube", alpha: ["-alpha", "Opaque"] },
    ])(`${mode}: Hald lookup with $name`, async ({ alpha }) => {
        const argv = ["xc:#20406080", "(", "hald:2", ...alpha, ")", "-hald-clut", "+channel", "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe("204060ff");
    });
}
