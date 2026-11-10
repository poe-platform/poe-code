import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit channel output.
const cases = [
    { alpha: "deactivate", resize: true, expected: "35649380e2d3c3c0" },
    { alpha: "disassociate", resize: true, expected: "88ffff00ffffff00" },
    { alpha: "on", resize: true, expected: "35649350e2d3c3b0" },
    { alpha: "discrete", resize: true, expected: "35649350e2d3c3b0" },
    { alpha: "associate", resize: true, expected: "0c213680a09285c0" },
    { alpha: "deactivate", resize: false, expected: "123456408badcf80fedcbac0" },
    { alpha: "disassociate", resize: false, expected: "48cfff40ffffff80fffff7c0" },
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${execution}: thumbnail with $alpha alpha, resampling=$resize`, async ({ alpha, resize, expected }) => {
        const argv = ["xc:#12345640", "xc:#8badcf80", "xc:#fedcbac0", "+append", "-alpha", alpha,
            ...(resize ? ["-thumbnail", "2x1!"] : []), "-alpha", "activate",
            "-depth", "8", `rgba:${execution === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = execution === "command" ? stdout
            : Buffer.from(execution === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
