import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI, row-major depth-8 RGB.
const cases = [
    { page: ["-repage", "8x7+2+1"], angle: "180", expected: "8090a0a090a09090a0102030708090405060" },
    { page: ["-repage", "8x7+2+1"], angle: "90", expected: "787c8c787c8c787c8c687080687080687080" },
    { page: ["+repage"], angle: "180", expected: "a090a09090a08090a0708090405060102030" },
    { page: ["-repage", "8x7+2+1"], angle: "0", expected: "1020304050607080908090a09090a0a090a0" },
    { page: ["-repage", "8x7-2-1"], angle: "90", expected: "687080687080687080586474586474586474" },
    { page: ["-repage", "8x7"], angle: "180", expected: "a090a09090a08090a0708090405060102030" },
    { page: ["-repage", "8x7+2+1"], angle: "1,180", expected: "8090a0a090a09090a0102030708090405060" },
    { page: ["-repage", "8x7+2+1"], angle: "1.5,1,180", expected: "a090a09090a08090a0708090405060102030" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: SRT $angle with page $page matches native`, async ({ page, angle, expected }) => {
        const argv = ["xc:#102030", "xc:#405060", "xc:#708090", "+append",
            "(", "xc:#8090a0", "xc:#9090a0", "xc:#a090a0", "+append", ")", "-append",
            ...page, "-filter", "point", "-virtual-pixel", "tile", "-distort", "SRT", angle,
            "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
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
