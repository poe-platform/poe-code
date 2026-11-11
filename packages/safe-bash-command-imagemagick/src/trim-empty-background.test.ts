import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
    it.each([
        { background: ["-background", "red"], alpha: ["-alpha", "opaque"], pixel: [255, 0, 0, 255] },
        { background: ["-background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: ["-set", "background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: ["-set", "background", "red"], alpha: ["-alpha", "off"], pixel: [255, 0, 0, 255] },
        { background: ["-set", "option:background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: ["-background", "blue", "-set", "background", "red"], alpha: [], pixel: [0, 0, 255, 0] },
        { background: ["-set", "background", "blue", "-background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: [], alpha: ["-alpha", "opaque"], pixel: [255, 255, 255, 255] },
    ])(`${mode}: uses the empty trim background ($background, $alpha)`, async ({ background, alpha, pixel }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = ["-size", "6x5", "xc:white", ...background, "-trim", ...alpha, "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(new Uint8Array(pixel));
    });
}
