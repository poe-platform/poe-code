import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "active extraction", reads: ["-extract", "1x1+1+0", "mpr:a"], expected: "1x1:srgb(0,0,255);" },
        { name: "inline extraction", reads: ["mpr:a[1x1+1+0]"], expected: "1x1:srgb(0,0,255);" },
        { name: "inline geometry overrides extraction", reads: ["-extract", "1x1+1+0", "mpr:a[1x1+0+0]"], expected: "1x1:srgb(255,0,0);" },
        { name: "saved pixels survive extraction", reads: ["-extract", "1x1+1+0", "mpr:a", "+extract", "mpr:a"], expected: "1x1:srgb(0,0,255);2x1:srgb(255,0,0);" },
    ])(`applies MPR read geometry: $name, ${mode}`, async ({ reads, expected }) => {
        const filesystem = new MemoryFileSystem();
        const args = ["xc:red", "xc:blue", "+append", "-write", "mpr:a", "+delete", ...reads, "-format", "%wx%h:%[pixel:p{0,0}];", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
