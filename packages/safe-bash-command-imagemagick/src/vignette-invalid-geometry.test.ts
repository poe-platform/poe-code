import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(["1.2.3", "1e", "5+", "2++", "bad", "1x1+1", "1e-1x1+1", "1.x1+1", ".5x1+1", "1x1++1"])(`${mode}: validates vignette %s before replacing output`, async geometry => {
    const sentinel = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", sentinel]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", sentinel);
    const args = ["-size", "6x4", "xc:#3876b4", "-background", "#d29153", "-vignette", geometry, "-depth", "8", "rgba:/out"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    const valid = geometry.includes("x");
    expect(result.exitCode).toBe(valid ? 0 : 1);
    if (valid) {
        // Native ImageMagick 7.1.2 Q16-HDRI, raw RGBA8.
        expect(createHash("sha256").update(output).digest("hex")).toBe("9870a8b1951dd7a344a4b10c8dc0dde2b6396cdff4c1e3ad899a35d9b82714e8");
    } else {
        expect(output).toEqual(sentinel);
    }
});
