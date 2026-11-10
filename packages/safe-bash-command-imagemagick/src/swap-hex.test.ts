import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const colors = { R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], W: [255, 255, 255] };

// Native ImageMagick 7.1.2-35: signs and preceding fields disambiguate hexadecimal x.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["+0x1", "RWBG"], ["1,0x2", "RBGW"], ["1x0x2", "RBGW"],
        ["0x1", "GRBW"], ["0x2", "BGRW"], ["1,0x0", "GRBW"],
        ["1,2", "RBGW"], ["1", "RWBG"]
    ])(`resolves hexadecimal swap %s in ${mode}`, async (spec, order) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", original);
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-swap", spec!, "+append", "-depth", "8", "rgb:/out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs: filesystem, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect([...output]).toEqual([...order!].flatMap(color => colors[color as keyof typeof colors]));
    });
}
