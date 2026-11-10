import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Multiply", "#3876b4", "#d29153", "7fdd97ef19916745662cbb6db409d31fbd0a99c40ede092b4f6cb46f43f1c80f"],
        ["Screen", "#3876b4", "#d29153", "a6099ba09ced9fc484b281b673d2e080ddbb7b9a0c7eb5ed7aa0fb94a84a5442"],
        ["Difference", "#3876b4", "#d29153", "54ca38f1ccdd8130e8ce297daec93e2cfe40953dc88dfa9a5e21296d588e7df4"],
        ["Over", "#3876b4", "#d29153", "27e57b059415ca01478c819165f90ede7cd67ede4c99864c7ce1ca266a08a58b"],
        ["Multiply", "#3876b480", "#d2915340", "aa182945e6637cd5d5924fe75a0eac85e0d1de2b9dc4320bd956fb5b1e57a474"],
        ["Over", "#3876b480", "#d2915340", "e5a18f11a18373b8ffaa74e81426f6c5650f263a8b170184ab2a1a501cc5e574"],
    ] as const)(`matches native vignette %s with %s on %s (${backend})`, async (compose, source, background, digest) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "6x4", `xc:${source}`, "-background", background,
            "-compose", compose, "-vignette", "0x0+1+1", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(6 * 4 * 4);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
