import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI output, including stored alpha after reactivation.
const cases = [
    { alpha: "Discrete", sepia: false, expected: "20406040a08050c0" },
    { alpha: "Discrete", sepia: true, expected: "66000000fff23dff" },
    { alpha: "Deactivate", sepia: true, expected: "66000040fff23dc0" },
    { alpha: "On", sepia: true, expected: "66000000fff23dff" },
    { alpha: "Off", sepia: true, expected: "66000000fff23d00" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: alpha $alpha with sepia=$sepia`, async ({ alpha, sepia, expected }) => {
        const argv = ["xc:#20406040", "xc:#a08050c0", "+append", "-alpha", alpha,
            ...(sepia ? ["-sepia-tone", "80%"] : []), "-alpha", "activate", "-colorspace", "sRGB", "-depth", "8",
            `rgba:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
