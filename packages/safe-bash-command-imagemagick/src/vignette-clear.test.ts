import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, row-major RGBA8 (including hidden RGB).
for (const backend of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["Clear", "24045c10c12a89f4c11e3b88ea34558fcdf926a8c1008cd08cc33bc71407c774"],
    ["Over", "8afa5d6cceff8ef337955287c79b91c44bc9557c40fd782c7b8559265091b121"]
])(`matches native vignette compose=%s (${backend})`, async (compose, hash) => {
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
    expect(output).toHaveLength(7 * 5 * 4);
    if (compose === "Clear") expect(output).toEqual(new Uint8Array(7 * 5 * 4));
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
