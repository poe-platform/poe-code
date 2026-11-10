import { expect, it } from "vitest";
import { createCommandArguments } from "safe-bash-contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["1,2:1", "GRBW"],
        ["2,3:1", "GRBW"],
        ["1,2:3", "GRBW"],
        ["2,1:2", "RBGW"],
        ["1,2", "RBGW"],
        ["1:2", "GRBW"]
    ])(`honors swap ratio geometry %s in ${mode}`, async (spec, order) => {
        const existing = new TextEncoder().encode("KEEP");
        const files = new Map([["out", existing]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", existing);
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-swap", spec!, "+append", "-depth", "8", "rgb:out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs: filesystem, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        const colors = { R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], W: [255, 255, 255] };
        expect([...output]).toEqual([...order!].flatMap(color => colors[color as keyof typeof colors]));
    });
}
