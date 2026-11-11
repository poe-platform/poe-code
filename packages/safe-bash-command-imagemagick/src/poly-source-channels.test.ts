import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { secondChannel: "G", terms: "1,1", expected: "330000" },
        { secondChannel: "G", terms: "0,1,1,1", expected: "000000" },
        { secondChannel: "R", terms: "1,1", expected: "330000" },
        { secondChannel: "R", terms: "0,1,1,1", expected: "cc0000" },
    ])(`${mode}: uses source channels R/$secondChannel for polynomial $terms`, async ({ secondChannel, terms, expected }) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = ["(", "xc:#336699", "-channel", "R", ")",
            "(", "xc:#cc8040", "-channel", secondChannel, ")",
            "-poly", terms, "+channel", "-colorspace", "sRGB", "-depth", "8", "rgb:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
