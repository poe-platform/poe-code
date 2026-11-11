import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Exclusion", "a9543168", "142ed7ab2cccfb1292586842217815f83d182ca1e2a0893f7afdb570301933f7"],
        ["Difference", "a84f3053", "1077c8518fce115fbfe17c1f35e2fc7c1d6dd81bd231ec5b61e53541e7173759"],
        ["Over", "a4533268", "8afa5d6cceff8ef337955287c79b91c44bc9557c40fd782c7b8559265091b121"]
    ])(`matches native vignette %s (${backend})`, async (compose, corner, hash) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["-size", "7x5", "xc:#3169af80", "-background", "#b4502060", "-compose", compose,
            "-vignette", "0x1+1+1", "-depth", "8", "rgba:/output.raw"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : backend === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/output.raw") : files.get("/output.raw")!;
        expect(output.length).toBe(7 * 5 * 4);
        expect(Buffer.from(output.slice(0, 4)).toString("hex")).toBe(corner);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
