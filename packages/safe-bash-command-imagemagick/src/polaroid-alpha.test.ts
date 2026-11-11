import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI complete RGBA output.
for (const mode of ["command", "buffered", "sync"] as const) it.each([
    { alpha: "off", hash: "b8ecb9dfdb968a05bcf7cac864f2f12549da5800d62bbc422448fded19a209cd" },
    { alpha: "disassociate", hash: "178166334c3331095056b6504e93c370c9e8e19f87fa5e9e2e64cde3da904a89" },
    { alpha: "deactivate", hash: "5cd92ae56dc8406d171a6f7d913f3d605c63a9968760101a151b1a9a69c9fab2" },
    { alpha: undefined, hash: "5cd92ae56dc8406d171a6f7d913f3d605c63a9968760101a151b1a9a69c9fab2" },
])(`${mode}: preserves transparent polaroid corners after alpha $alpha`, async ({ alpha, hash }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-seed", "7", "xc:#ac593e80", ...(alpha ? ["-alpha", alpha] : []), "-polaroid", "0", "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files) : mode === "buffered" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
    });
    expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
    const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
    expect(output.byteLength).toBe(3364);
    expect(Array.from(output.slice(28 * 4, 29 * 4))).toEqual([255, 255, 255, 0]);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
