import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete RGB output from native ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        [[], "0a0a0a0e0e0e222222262626"],
        [["-set", "option:sample:offset", "0"], "010101040404111111141414"],
        [["-define", "sample:offset=0"], "010101040404111111141414"],
        [["-define", "sample:offset=25x75", "-set", "option:sample:offset", "75x25"], "0303030707071b1b1b1f1f1f"],
        [["-set", "option:sample:offset", "75x25", "-define", "sample:offset=0"], "010101040404111111141414"],
        [["-set", "option:sample:offset", "0", "+set", "option:sample:offset"], "0a0a0a0e0e0e222222262626"],
        [["-define", "sample:offset=0", "+set", "option:sample:offset"], "0a0a0a0e0e0e222222262626"],
        [["-set", "option:sample:offset", "0", "+define", "sample:offset"], "0a0a0a0e0e0e222222262626"],
    ] as [string[], string][])(`${mode} applies sampling options %j`, async (options, expected) => {
        const input = Uint8Array.from(Array.from({ length: 48 }, (_, i) => [i + 1, i + 1, i + 1]).flat());
        const files = new Map([["in.rgb", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.rgb", input);
        const args = ["-size", "8x6", "-depth", "8", "rgb:in.rgb", ...options, "-sample", "2x2!", "-depth", "8", "rgb:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        const output = "stdoutBytes" in result ? result.stdoutBytes! : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
