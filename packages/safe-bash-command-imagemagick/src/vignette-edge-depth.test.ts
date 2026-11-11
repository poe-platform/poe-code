import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA in row-major order.
for (const backend of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["Over", 16, "a45353703201687d", "2ba69b3525854721b03f111903dcc3bfa9e7ce4145a84548bbde4ee86effb0e0"],
    ["Src", 16, "31316969afaf0d03", "60abea8c3e86116d3e39d11ed0b5083c8be0393be26bcdacc3bbfe9ea968497d"],
    ["CopyAlpha", 16, "b4b4505020200d03", "38f71f4ed459b7c8b345dea4311c918de9a0f03b670d1c7f725505b415a08b56"],
    ["Dst", 16, "b4b4505020206060", "5be245d51cd81305a2e75366ae9263e37b7ed962ebf298e4fab72739f4231c0c"],
    ["Over", 8, "a4533268", "8afa5d6cceff8ef337955287c79b91c44bc9557c40fd782c7b8559265091b121"]
] as const)(`retains calculated vignette %s edges at depth %i (${backend})`, async (compose, depth, corner, hash) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const argv = ["-size", "7x5", "xc:#3169af80", "-background", "#b4502060", "-compose", compose,
        "-vignette", "0x1+1+1", "-depth", String(depth), "-endian", "MSB", "rgba:/output.raw"];
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
    expect(output.length).toBe(7 * 5 * 4 * depth / 8);
    expect(Buffer.from(output.slice(0, 4 * depth / 8)).toString("hex")).toBe(corner);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
